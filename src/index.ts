import loadPdfium, { type LoadPdfiumOptions, type PdfiumModule } from "./vendor/pdfium.esm.js";
import { BitmapFormat, PdfErrorCode, PDFIUM_RELEASE, PDFIUM_WASM_SHA256, RenderFlag } from "./constants.js";
import { encodePngRgba } from "./png.js";

export { encodePngRgba, PDFIUM_RELEASE, PDFIUM_WASM_SHA256 };

export type ClawPdfLoadOptions = {
  wasmBinary?: ArrayBuffer;
  wasmUrl?: string;
  instantiateWasm?: LoadPdfiumOptions["instantiateWasm"];
};

export type PdfRenderOptions = {
  scale?: number;
  width?: number;
  height?: number;
  renderForms?: boolean;
  transparent?: boolean;
};

export type PdfRenderedPage = {
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  rgba: Uint8Array;
};

export type PdfPngPage = Omit<PdfRenderedPage, "rgba"> & {
  png: Uint8Array;
};

export type PdfExtractOptions = {
  maxPages?: number;
  maxPixels?: number;
  minTextChars?: number;
  pageNumbers?: number[];
  renderScale?: number;
};

export type PdfExtractedImage = {
  data: string;
  mimeType: "image/png";
  type: "image";
  pageNumber: number;
};

export type PdfExtractResult = {
  text: string;
  images: PdfExtractedImage[];
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-16le");
const maxExtractedTextChars = 200_000;
const defaultMaxPages = 20;
const defaultMaxPixels = 4_000_000;
const defaultMinTextChars = 200;

export async function loadClawPDF(options: ClawPdfLoadOptions = {}): Promise<ClawPDF> {
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
  return new ClawPDF(module);
}

export async function extractPdfContent(
  input: Uint8Array | ArrayBuffer,
  options: PdfExtractOptions = {},
): Promise<PdfExtractResult> {
  const library = await loadClawPDF();
  try {
    const document = library.loadDocument(input);
    try {
      return document.extractContent(options);
    } finally {
      document.destroy();
    }
  } finally {
    library.destroy();
  }
}

export class ClawPDF {
  readonly pdfiumRelease = PDFIUM_RELEASE;
  readonly wasmSha256 = PDFIUM_WASM_SHA256;
  #destroyed = false;

  constructor(private readonly module: PdfiumModule) {}

  loadDocument(input: Uint8Array | ArrayBuffer, password = ""): PdfDocument {
    this.#assertLive();
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const documentPtr = this.#malloc(bytes.byteLength);
    this.module.HEAPU8.set(bytes, documentPtr);

    const passwordPtr = password ? this.#stringToCString(password) : 0;
    const documentHandle = this.module._FPDF_LoadMemDocument(documentPtr, bytes.byteLength, passwordPtr);
    if (passwordPtr) {
      this.module.wasmExports.free(passwordPtr);
    }
    if (!documentHandle) {
      this.module.wasmExports.free(documentPtr);
      throw new Error(pdfLoadErrorMessage(this.module._FPDF_GetLastError()));
    }
    return new PdfDocument(this.module, documentHandle, documentPtr);
  }

  destroy(): void {
    if (this.#destroyed) {
      return;
    }
    this.module._FPDF_DestroyLibrary();
    this.#destroyed = true;
  }

  #assertLive(): void {
    if (this.#destroyed) {
      throw new Error("ClawPDF library has been destroyed");
    }
  }

  #malloc(size: number): number {
    const ptr = this.module.wasmExports.malloc(size);
    if (!ptr) {
      throw new Error(`PDFium malloc failed for ${size} bytes`);
    }
    return ptr;
  }

  #stringToCString(value: string): number {
    const bytes = textEncoder.encode(`${value}\0`);
    const ptr = this.#malloc(bytes.byteLength);
    this.module.HEAPU8.set(bytes, ptr);
    return ptr;
  }
}

export class PdfDocument {
  #destroyed = false;
  #formHandle = 0;
  #formPtr = 0;

  constructor(
    private readonly module: PdfiumModule,
    private readonly documentHandle: number,
    private readonly documentPtr: number,
  ) {}

  get pageCount(): number {
    this.#assertLive();
    return this.module._FPDF_GetPageCount(this.documentHandle);
  }

  getPageText(pageIndex: number): string {
    return withPage(this.module, this.documentHandle, this.#checkPageIndex(pageIndex), (page) => {
      const textPage = this.module._FPDFText_LoadPage(page);
      if (!textPage) {
        throw new Error(`Failed to load text page ${pageIndex}`);
      }
      try {
        const charCount = this.module._FPDFText_CountChars(textPage);
        if (charCount <= 0) {
          return "";
        }
        const byteLength = (charCount + 1) * 2;
        const textPtr = this.#malloc(byteLength);
        try {
          const length = this.module._FPDFText_GetText(textPage, 0, charCount, textPtr);
          if (length <= 0) {
            return "";
          }
          return textDecoder.decode(this.module.HEAPU8.slice(textPtr, textPtr + (length - 1) * 2));
        } finally {
          this.module.wasmExports.free(textPtr);
        }
      } finally {
        this.module._FPDFText_ClosePage(textPage);
      }
    });
  }

  extractText(options: Pick<PdfExtractOptions, "maxPages" | "pageNumbers"> = {}): string {
    const parts: string[] = [];
    let length = 0;
    for (const pageIndex of this.#effectivePageIndexes(options.maxPages, options.pageNumbers)) {
      const pageText = this.getPageText(pageIndex);
      if (!pageText) {
        continue;
      }
      const remaining = maxExtractedTextChars - length;
      if (remaining <= 0) {
        break;
      }
      const next = pageText.length > remaining ? pageText.slice(0, remaining) : pageText;
      parts.push(next);
      length += next.length;
    }
    return parts.join("\n\n");
  }

  renderPage(pageIndex: number, options: PdfRenderOptions = {}): PdfRenderedPage {
    return withPage(this.module, this.documentHandle, this.#checkPageIndex(pageIndex), (page) => {
      const originalWidth = this.module._FPDF_GetPageWidth(page);
      const originalHeight = this.module._FPDF_GetPageHeight(page);
      const baseWidth = options.width ?? originalWidth;
      const baseHeight = options.height ?? originalHeight;
      const scale = options.scale ?? 1;
      const width = Math.max(1, Math.floor(baseWidth * scale));
      const height = Math.max(1, Math.floor(baseHeight * scale));
      const byteLength = width * height * 4;
      const bitmapPtr = this.#malloc(byteLength);
      const bitmap = this.module._FPDFBitmap_CreateEx(
        width,
        height,
        BitmapFormat.Bgra,
        bitmapPtr,
        width * 4,
      );
      if (!bitmap) {
        this.module.wasmExports.free(bitmapPtr);
        throw new Error("Failed to create PDFium bitmap");
      }

      let formHandle = 0;
      try {
        const fillColor = options.transparent === true ? 0x00000000 : 0xffffffff;
        this.module._FPDFBitmap_FillRect(bitmap, 0, 0, width, height, fillColor);
        let flags = RenderFlag.Annot | RenderFlag.LcdText | RenderFlag.ReverseByteOrder;
        this.module._FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, 0, flags);

        if (options.renderForms === true) {
          formHandle = this.#ensureFormHandle();
          this.module._FORM_OnAfterLoadPage(page, formHandle);
          flags &= ~RenderFlag.Annot;
          this.module._FPDF_FFLDraw(formHandle, bitmap, page, 0, 0, width, height, 0, flags);
          this.module._FORM_OnBeforeClosePage(page, formHandle);
        }

        return {
          width,
          height,
          originalWidth: Math.floor(originalWidth),
          originalHeight: Math.floor(originalHeight),
          rgba: this.module.HEAPU8.slice(bitmapPtr, bitmapPtr + byteLength),
        };
      } finally {
        this.module._FPDFBitmap_Destroy(bitmap);
        this.module.wasmExports.free(bitmapPtr);
      }
    });
  }

  renderPagePng(pageIndex: number, options: PdfRenderOptions = {}): PdfPngPage {
    const rendered = this.renderPage(pageIndex, options);
    return {
      width: rendered.width,
      height: rendered.height,
      originalWidth: rendered.originalWidth,
      originalHeight: rendered.originalHeight,
      png: encodePngRgba(rendered.width, rendered.height, rendered.rgba),
    };
  }

  extractContent(options: PdfExtractOptions = {}): PdfExtractResult {
    const maxPages = options.maxPages ?? defaultMaxPages;
    const maxPixels = options.maxPixels ?? defaultMaxPixels;
    const minTextChars = options.minTextChars ?? defaultMinTextChars;
    const pageIndexes = this.#effectivePageIndexes(maxPages, options.pageNumbers);
    const text = this.extractText({ maxPages, ...(options.pageNumbers ? { pageNumbers: options.pageNumbers } : {}) });
    if (text.trim().length >= minTextChars) {
      return { text, images: [] };
    }

    const images: PdfExtractedImage[] = [];
    let remainingPixels = Math.max(1, Math.floor(maxPixels));
    for (const pageIndex of pageIndexes) {
      const plan = this.#renderPlan(pageIndex, remainingPixels, options.renderScale);
      if (!plan) {
        break;
      }
      const rendered = this.renderPagePng(pageIndex, {
        scale: plan.scale,
        renderForms: true,
      });
      images.push({
        type: "image",
        mimeType: "image/png",
        data: bytesToBase64(rendered.png),
        pageNumber: pageIndex + 1,
      });
      remainingPixels -= rendered.width * rendered.height;
    }
    return { text, images };
  }

  destroy(): void {
    if (this.#destroyed) {
      return;
    }
    if (this.#formHandle) {
      this.module._FPDFDOC_ExitFormFillEnvironment(this.#formHandle);
      this.#formHandle = 0;
    }
    if (this.#formPtr) {
      this.module.wasmExports.free(this.#formPtr);
      this.#formPtr = 0;
    }
    this.module._FPDF_CloseDocument(this.documentHandle);
    this.module.wasmExports.free(this.documentPtr);
    this.#destroyed = true;
  }

  #effectivePageIndexes(maxPages = defaultMaxPages, pageNumbers?: number[]): number[] {
    this.#assertLive();
    const count = this.pageCount;
    if (pageNumbers) {
      return pageNumbers
        .filter((pageNumber) => Number.isInteger(pageNumber) && pageNumber >= 1 && pageNumber <= count)
        .slice(0, maxPages)
        .map((pageNumber) => pageNumber - 1);
    }
    return Array.from({ length: Math.min(count, maxPages) }, (_, i) => i);
  }

  #renderPlan(pageIndex: number, remainingPixels: number, preferredScale?: number): { scale: number } | null {
    return withPage(this.module, this.documentHandle, this.#checkPageIndex(pageIndex), (page) => {
      const width = this.module._FPDF_GetPageWidth(page);
      const height = this.module._FPDF_GetPageHeight(page);
      if (remainingPixels <= 0 || width <= 0 || height <= 0) {
        return null;
      }
      const maxScale = Math.sqrt(remainingPixels / Math.max(1, width * height));
      const scale = Math.min(preferredScale ?? 1, maxScale);
      return Number.isFinite(scale) && scale > 0 ? { scale } : null;
    });
  }

  #ensureFormHandle(): number {
    if (this.#formHandle) {
      return this.#formHandle;
    }
    this.#formPtr = this.#malloc(256);
    this.module.HEAPU8.fill(0, this.#formPtr, this.#formPtr + 256);
    new DataView(this.module.HEAPU8.buffer).setUint32(this.#formPtr, 2, true);
    this.#formHandle = this.module._FPDFDOC_InitFormFillEnvironment(this.documentHandle, this.#formPtr);
    if (!this.#formHandle) {
      this.module.wasmExports.free(this.#formPtr);
      this.#formPtr = 0;
      throw new Error("Failed to initialize PDF form fill environment");
    }
    return this.#formHandle;
  }

  #checkPageIndex(pageIndex: number): number {
    this.#assertLive();
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= this.pageCount) {
      throw new RangeError(`Page index ${pageIndex} is outside 0..${this.pageCount - 1}`);
    }
    return pageIndex;
  }

  #assertLive(): void {
    if (this.#destroyed) {
      throw new Error("PDF document has been destroyed");
    }
  }

  #malloc(size: number): number {
    const ptr = this.module.wasmExports.malloc(size);
    if (!ptr) {
      throw new Error(`PDFium malloc failed for ${size} bytes`);
    }
    return ptr;
  }
}

function withPage<T>(
  module: PdfiumModule,
  documentHandle: number,
  pageIndex: number,
  callback: (page: number) => T,
): T {
  const page = module._FPDF_LoadPage(documentHandle, pageIndex);
  if (!page) {
    throw new Error(`Failed to load PDF page ${pageIndex}`);
  }
  try {
    return callback(page);
  } finally {
    module._FPDF_ClosePage(page);
  }
}

function pdfLoadErrorMessage(code: number): string {
  switch (code) {
    case PdfErrorCode.File:
      return "PDF file could not be opened";
    case PdfErrorCode.Format:
      return "Input is not a valid PDF or is corrupted";
    case PdfErrorCode.Password:
      return "PDF password is required or incorrect";
    case PdfErrorCode.Security:
      return "PDF security handler is unsupported";
    case PdfErrorCode.Page:
      return "PDF page could not be loaded";
    case PdfErrorCode.Unknown:
      return "Unknown PDFium error";
    default:
      return `PDFium load failed with error ${code}`;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
