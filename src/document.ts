import { BitmapFormat, RenderFlag } from "./constants.js";
import { type EngineImpl } from "./engine.js";
import {
  PdfDestroyedError,
  PdfFormatError,
  PdfPageRangeError,
} from "./errors.js";
import { type ExtractOptions, type ExtractResult, extractDocument } from "./extract.js";
import { PageImpl, type PdfPage } from "./page.js";
import { type RenderOptions, nonNegativeInteger, positiveInteger, resolveRenderSize } from "./render.js";

export type DocumentDestroyHook = () => void;

export type PdfMetadata = {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  creator?: string;
  producer?: string;
  creationDate?: Date;
  modificationDate?: Date;
};

export interface PdfDocument extends Disposable, AsyncDisposable {
  readonly pageCount: number;
  readonly metadata: PdfMetadata;
  page(pageNumber: number): PdfPage;
  pages(range?: { from?: number; to?: number }): IterableIterator<PdfPage>;
  text(options?: TextOptions): string;
  extract(options?: ExtractOptions): Promise<ExtractResult>;
  destroy(): void;
}

export type TextOptions = {
  pages?: number[];
  maxPages?: number;
  maxChars?: number;
};

export type TextExtraction = {
  text: string;
  pagesProcessed: number[];
  truncated: boolean;
};

const textDecoder = new TextDecoder("utf-16le");
const defaultMaxPages = 20;
const defaultMaxTextChars = 200_000;

export class DocumentImpl implements PdfDocument {
  #destroyed = false;
  #formHandle = 0;
  #formPtr = 0;
  #metadata?: PdfMetadata;

  constructor(
    readonly engine: EngineImpl,
    readonly documentHandle: number,
    private readonly documentPtr: number,
    private readonly releaseDocument: () => void,
    private readonly onDestroy?: DocumentDestroyHook,
  ) {}

  get pageCount(): number {
    this.assertLive();
    return this.engine.module._FPDF_GetPageCount(this.documentHandle);
  }

  get metadata(): PdfMetadata {
    this.assertLive();
    this.#metadata ??= this.readMetadata();
    return this.#metadata;
  }

  page(pageNumber: number): PdfPage {
    this.checkPageNumber(pageNumber);
    return new PageImpl(this, pageNumber);
  }

  *pages(range: { from?: number; to?: number } = {}): IterableIterator<PdfPage> {
    this.assertLive();
    const from = range.from ?? 1;
    const to = range.to ?? this.pageCount;
    this.checkPageNumber(from);
    this.checkPageNumber(to);
    for (let pageNumber = from; pageNumber <= to; pageNumber += 1) {
      yield this.page(pageNumber);
    }
  }

  text(options: TextOptions = {}): string {
    return this.extractText(options).text;
  }

  async extract(options: ExtractOptions = {}): Promise<ExtractResult> {
    return extractDocument(this, options);
  }

  destroy(): void {
    if (this.#destroyed) {
      return;
    }
    if (this.#formHandle) {
      this.engine.module._FPDFDOC_ExitFormFillEnvironment(this.#formHandle);
      this.#formHandle = 0;
    }
    if (this.#formPtr) {
      this.engine.module.wasmExports.free(this.#formPtr);
      this.#formPtr = 0;
    }
    this.engine.module._FPDF_CloseDocument(this.documentHandle);
    this.engine.module.wasmExports.free(this.documentPtr);
    this.#destroyed = true;
    this.releaseDocument();
    this.onDestroy?.();
  }

  [Symbol.dispose](): void {
    this.destroy();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.destroy();
  }

  extractText(options: TextOptions = {}): TextExtraction {
    this.assertLive();
    const maxChars = nonNegativeInteger("maxChars", options.maxChars ?? defaultMaxTextChars);
    const pageNumbers = this.effectivePageNumbers(options);
    const parts: string[] = [];
    const pagesProcessed: number[] = [];
    let length = 0;
    let truncated = false;

    for (const pageNumber of pageNumbers) {
      const pageText = this.getPageText(pageNumber);
      pagesProcessed.push(pageNumber);
      if (!pageText) {
        continue;
      }
      const separator = parts.length ? "\n\n" : "";
      const remaining = maxChars - length - separator.length;
      if (remaining <= 0) {
        truncated = true;
        break;
      }
      const next = pageText.length > remaining ? pageText.slice(0, remaining) : pageText;
      if (separator) {
        parts.push(separator);
        length += separator.length;
      }
      parts.push(next);
      length += next.length;
      if (next.length < pageText.length) {
        truncated = true;
        break;
      }
    }

    return { text: parts.join(""), pagesProcessed, truncated };
  }

  effectivePageNumbers(options: Pick<TextOptions, "pages" | "maxPages"> = {}): number[] {
    this.assertLive();
    const pageCount = this.pageCount;
    if (options.pages) {
      const limit = options.maxPages === undefined
        ? options.pages.length
        : positiveInteger("maxPages", options.maxPages);
      const selected = options.pages.slice(0, limit);
      for (const pageNumber of selected) {
        this.checkPageNumber(pageNumber);
      }
      return selected;
    }
    const limit = options.maxPages === undefined ? defaultMaxPages : positiveInteger("maxPages", options.maxPages);
    return Array.from({ length: Math.min(pageCount, limit) }, (_, index) => index + 1);
  }

  getPageText(pageNumber: number): string {
    return this.withLoadedPage(pageNumber, (page) => {
      const textPage = this.engine.module._FPDFText_LoadPage(page);
      if (!textPage) {
        throw new PdfFormatError(`Failed to load text page ${pageNumber}`);
      }
      try {
        const charCount = this.engine.module._FPDFText_CountChars(textPage);
        if (charCount <= 0) {
          return "";
        }
        const byteLength = (charCount + 1) * 2;
        const textPtr = this.engine.malloc(byteLength);
        try {
          const length = this.engine.module._FPDFText_GetText(textPage, 0, charCount, textPtr);
          if (length <= 0) {
            return "";
          }
          return textDecoder.decode(this.engine.module.HEAPU8.slice(textPtr, textPtr + (length - 1) * 2));
        } finally {
          this.engine.module.wasmExports.free(textPtr);
        }
      } finally {
        this.engine.module._FPDFText_ClosePage(textPage);
      }
    });
  }

  renderPage(pageNumber: number, options: RenderOptions = {}): { width: number; height: number; rgba: Uint8Array } {
    return this.withLoadedPage(pageNumber, (page) => {
      const pageWidth = this.engine.module._FPDF_GetPageWidth(page);
      const pageHeight = this.engine.module._FPDF_GetPageHeight(page);
      const size = resolveRenderSize(pageWidth, pageHeight, 0, options, this.engine.maxRenderPixels);
      const byteLength = size.width * size.height * 4;
      const bitmapPtr = this.engine.malloc(byteLength);
      const bitmap = this.engine.module._FPDFBitmap_CreateEx(
        size.width,
        size.height,
        BitmapFormat.Bgra,
        bitmapPtr,
        size.width * 4,
      );
      if (!bitmap) {
        this.engine.module.wasmExports.free(bitmapPtr);
        throw new PdfFormatError("Failed to create PDFium bitmap");
      }

      try {
        const fillColor = options.background === "transparent" ? 0x00000000 : 0xffffffff;
        this.engine.module._FPDFBitmap_FillRect(bitmap, 0, 0, size.width, size.height, fillColor);
        let flags = RenderFlag.Annot | RenderFlag.LcdText | RenderFlag.ReverseByteOrder;
        this.engine.module._FPDF_RenderPageBitmap(bitmap, page, 0, 0, size.width, size.height, size.rotate, flags);

        if (options.forms === true) {
          const formHandle = this.ensureFormHandle();
          this.engine.module._FORM_OnAfterLoadPage(page, formHandle);
          flags &= ~RenderFlag.Annot;
          this.engine.module._FPDF_FFLDraw(formHandle, bitmap, page, 0, 0, size.width, size.height, size.rotate, flags);
          this.engine.module._FORM_OnBeforeClosePage(page, formHandle);
        }

        return {
          width: size.width,
          height: size.height,
          rgba: this.engine.module.HEAPU8.slice(bitmapPtr, bitmapPtr + byteLength),
        };
      } finally {
        this.engine.module._FPDFBitmap_Destroy(bitmap);
        this.engine.module.wasmExports.free(bitmapPtr);
      }
    });
  }

  withLoadedPage<T>(pageNumber: number, callback: (page: number) => T): T {
    this.checkPageNumber(pageNumber);
    const page = this.engine.module._FPDF_LoadPage(this.documentHandle, pageNumber - 1);
    if (!page) {
      throw new PdfFormatError(`Failed to load PDF page ${pageNumber}`);
    }
    try {
      return callback(page);
    } finally {
      this.engine.module._FPDF_ClosePage(page);
    }
  }

  checkPageNumber(pageNumber: number): void {
    this.assertLive();
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > this.pageCount) {
      throw new PdfPageRangeError(pageNumber, this.pageCount);
    }
  }

  assertLive(): void {
    if (this.#destroyed) {
      throw new PdfDestroyedError("PDF document has been destroyed");
    }
  }

  private ensureFormHandle(): number {
    if (this.#formHandle) {
      return this.#formHandle;
    }
    // PDFium reads the versioned FPDF_FORMFILLINFO struct by field offset.
    this.#formPtr = this.engine.malloc(this.engine.formFillInfoBytes);
    this.engine.module.HEAPU8.fill(0, this.#formPtr, this.#formPtr + this.engine.formFillInfoBytes);
    new DataView(this.engine.module.HEAPU8.buffer).setUint32(this.#formPtr, 2, true);
    this.#formHandle = this.engine.module._FPDFDOC_InitFormFillEnvironment(this.documentHandle, this.#formPtr);
    if (!this.#formHandle) {
      this.engine.module.wasmExports.free(this.#formPtr);
      this.#formPtr = 0;
      throw new PdfFormatError("Failed to initialize PDF form fill environment");
    }
    return this.#formHandle;
  }

  private readMetadata(): PdfMetadata {
    const metadata: PdfMetadata = {};
    assignIfPresent(metadata, "title", this.getMetaText("Title"));
    assignIfPresent(metadata, "author", this.getMetaText("Author"));
    assignIfPresent(metadata, "subject", this.getMetaText("Subject"));
    assignIfPresent(metadata, "keywords", this.getMetaText("Keywords"));
    assignIfPresent(metadata, "creator", this.getMetaText("Creator"));
    assignIfPresent(metadata, "producer", this.getMetaText("Producer"));
    assignIfPresent(metadata, "creationDate", parsePdfDate(this.getMetaText("CreationDate")));
    assignIfPresent(metadata, "modificationDate", parsePdfDate(this.getMetaText("ModDate")));
    return metadata;
  }

  private getMetaText(tag: string): string | undefined {
    const tagPtr = this.engine.stringToCString(tag);
    try {
      const byteLength = this.engine.module._FPDF_GetMetaText(this.documentHandle, tagPtr, 0, 0);
      if (byteLength <= 2) {
        return undefined;
      }
      const textPtr = this.engine.malloc(byteLength);
      try {
        const written = this.engine.module._FPDF_GetMetaText(this.documentHandle, tagPtr, textPtr, byteLength);
        if (written <= 2) {
          return undefined;
        }
        const text = textDecoder.decode(this.engine.module.HEAPU8.slice(textPtr, textPtr + written - 2));
        return text || undefined;
      } finally {
        this.engine.module.wasmExports.free(textPtr);
      }
    } finally {
      this.engine.module.wasmExports.free(tagPtr);
    }
  }
}

function assignIfPresent<K extends keyof PdfMetadata>(metadata: PdfMetadata, key: K, value: PdfMetadata[K] | undefined): void {
  if (value !== undefined) {
    metadata[key] = value;
  }
}

function pageRotationToDegrees(rotation: number): 0 | 90 | 180 | 270 {
  const normalized = ((rotation % 4) + 4) % 4;
  return (normalized * 90) as 0 | 90 | 180 | 270;
}

function parsePdfDate(value: string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }
  const match = value.match(/^D:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/);
  if (!match) {
    return undefined;
  }
  const [, year, month = "01", day = "01", hour = "00", minute = "00", second = "00"] = match;
  const date = new Date(Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  ));
  return Number.isNaN(date.getTime()) ? undefined : date;
}
