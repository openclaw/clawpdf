import loadPdfium, { type LoadPdfiumOptions, type PdfiumModule } from "./vendor/pdfium.esm.js";
import { PdfErrorCode as PdfiumErrorCode, PDFIUM_RELEASE, PDFIUM_WASM_SHA256 } from "./constants.js";
import { DocumentImpl, type DocumentDestroyHook } from "./document.js";
import {
  PdfDestroyedError,
  PdfFormatError,
  PdfPasswordError,
  PdfSecurityError,
} from "./errors.js";
import { type ExtractOptions, extractDocument } from "./extract.js";
import { type PdfInput, type PdfInputOptions, normalizePdfInput } from "./input.js";
import { positiveInteger } from "./render.js";

export type EngineOptions = {
  wasmBinary?: ArrayBuffer;
  wasmUrl?: string;
  instantiateWasm?: LoadPdfiumOptions["instantiateWasm"];
  maxRenderPixels?: number;
};

export type OpenPdfOptions = PdfInputOptions & {
  password?: string;
};

export interface PdfEngine extends AsyncDisposable {
  readonly pdfiumRelease: string;
  readonly wasmSha256: string;
  open(input: PdfInput, options?: OpenPdfOptions): Promise<PdfDocument>;
  extract(input: PdfInput, options?: ExtractOptions): Promise<ExtractResult>;
  destroy(): Promise<void>;
}

export type PdfDocument = import("./document.js").PdfDocument;
export type ExtractResult = import("./extract.js").ExtractResult;

const textEncoder = new TextEncoder();
const formFillInfoBytes = 1024;
const defaultMaxRenderPixels = 100_000_000;

export async function createEngineImpl(options: EngineOptions = {}): Promise<EngineImpl> {
  const loadOptions: LoadPdfiumOptions = {};
  if (options.wasmUrl) {
    loadOptions.locateFile = () => options.wasmUrl!;
  }
  if (options.wasmBinary) {
    loadOptions.wasmBinary = options.wasmBinary;
    loadOptions.locateFile = () => "";
  }
  if (options.instantiateWasm) {
    loadOptions.instantiateWasm = options.instantiateWasm;
  }

  const module = await loadPdfium(loadOptions);
  module._FPDF_InitLibraryWithConfig({
    version: 2,
    m_pIsolate: null,
    m_pPlatform: null,
    m_pUserFontPaths: null,
    m_v8EmbedderSlot: 0,
  });
  return new EngineImpl(module, options.maxRenderPixels ?? defaultMaxRenderPixels);
}

export class EngineImpl implements PdfEngine {
  readonly pdfiumRelease = PDFIUM_RELEASE;
  readonly wasmSha256 = PDFIUM_WASM_SHA256;
  readonly formFillInfoBytes = formFillInfoBytes;
  readonly maxRenderPixels: number;
  #destroyed = false;
  #destroying = false;
  #documents = new Set<DocumentImpl>();

  constructor(readonly module: PdfiumModule, maxRenderPixels: number) {
    this.maxRenderPixels = positiveInteger("maxRenderPixels", maxRenderPixels);
  }

  async open(input: PdfInput, options: OpenPdfOptions = {}): Promise<PdfDocument> {
    return this.openInternal(input, options);
  }

  async openPrivate(input: PdfInput, options: OpenPdfOptions = {}): Promise<PdfDocument> {
    return this.openInternal(input, options, () => {
      void this.destroy();
    });
  }

  async extract(input: PdfInput, options: ExtractOptions = {}): Promise<ExtractResult> {
    const openOptions: OpenPdfOptions = {};
    if (options.password !== undefined) {
      openOptions.password = options.password;
    }
    if (options.signal !== undefined) {
      openOptions.signal = options.signal;
    }
    if (options.fetchTimeoutMs !== undefined) {
      openOptions.fetchTimeoutMs = options.fetchTimeoutMs;
    }
    if (options.fetchMaxBytes !== undefined) {
      openOptions.fetchMaxBytes = options.fetchMaxBytes;
    }
    const document = await this.open(input, openOptions);
    try {
      return await extractDocument(document as DocumentImpl, options);
    } finally {
      document.destroy();
    }
  }

  async destroy(): Promise<void> {
    this.destroySync();
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.destroy();
  }

  malloc(size: number): number {
    const ptr = this.module.wasmExports.malloc(size);
    if (!ptr) {
      throw new PdfFormatError(`PDFium malloc failed for ${size} bytes`);
    }
    return ptr;
  }

  stringToCString(value: string): number {
    const bytes = textEncoder.encode(`${value}\0`);
    const ptr = this.malloc(bytes.byteLength);
    this.module.HEAPU8.set(bytes, ptr);
    return ptr;
  }

  private async openInternal(
    input: PdfInput,
    options: OpenPdfOptions,
    onDestroy?: DocumentDestroyHook,
  ): Promise<PdfDocument> {
    this.assertLive();
    const bytes = await normalizePdfInput(input, options);
    this.assertLive();
    const documentPtr = this.malloc(bytes.byteLength);
    this.module.HEAPU8.set(bytes, documentPtr);

    const passwordPtr = options.password ? this.stringToCString(options.password) : 0;
    const documentHandle = this.module._FPDF_LoadMemDocument(documentPtr, bytes.byteLength, passwordPtr);
    if (passwordPtr) {
      this.module.wasmExports.free(passwordPtr);
    }
    if (!documentHandle) {
      this.module.wasmExports.free(documentPtr);
      throw pdfLoadError(this.module._FPDF_GetLastError());
    }

    const document = new DocumentImpl(this, documentHandle, documentPtr, () => {
      this.#documents.delete(document);
    }, onDestroy);
    this.#documents.add(document);
    return document;
  }

  private destroySync(): void {
    if (this.#destroyed || this.#destroying) {
      return;
    }
    this.#destroying = true;
    for (const document of Array.from(this.#documents)) {
      document.destroy();
    }
    this.module._FPDF_DestroyLibrary();
    this.#destroyed = true;
    this.#destroying = false;
  }

  private assertLive(): void {
    if (this.#destroyed || this.#destroying) {
      throw new PdfDestroyedError("PDF engine has been destroyed");
    }
  }
}

function pdfLoadError(code: number): Error {
  switch (code) {
    case PdfiumErrorCode.File:
    case PdfiumErrorCode.Format:
      return new PdfFormatError();
    case PdfiumErrorCode.Password:
      return new PdfPasswordError();
    case PdfiumErrorCode.Security:
      return new PdfSecurityError();
    case PdfiumErrorCode.Page:
      return new PdfFormatError("PDF page could not be loaded");
    case PdfiumErrorCode.Unknown:
      return new PdfFormatError("Unknown PDFium error");
    default:
      return new PdfFormatError(`PDFium load failed with error ${code}`);
  }
}
