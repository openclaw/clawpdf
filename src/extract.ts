import { type DocumentImpl, type PdfDocument, type TextOptions } from "./document.js";
import { type PdfEngine } from "./engine.js";
import { type PdfInput } from "./input.js";
import { PdfFormatError } from "./errors.js";
import { planImageRender, positiveFiniteNumber, positiveInteger } from "./render.js";

export type ExtractMode = "auto" | "text" | "images" | "both";

export type ExtractOptions = {
  mode?: ExtractMode;
  password?: string;
  pages?: number[];
  maxPages?: number;
  minTextChars?: number;
  maxTextChars?: number;
  engine?: PdfEngine;
  image?: {
    dpi?: number;
    scale?: number;
    maxPixels?: number;
    maxDimension?: number;
    forms?: boolean;
    format?: "png";
  };
};

export type ExtractResult = {
  text: string;
  images: PdfImage[];
  pagesProcessed: number[];
  truncated: {
    text: boolean;
    images: boolean;
  };
};

export type PdfImage = {
  page: number;
  width: number;
  height: number;
  bytes: Uint8Array;
  mimeType: "image/png";
};

export type ExtractPdf = (input: PdfInput, options?: ExtractOptions) => Promise<ExtractResult>;

const defaultMaxPages = 20;
const defaultMaxTextChars = 200_000;
const defaultMinTextChars = 200;
const defaultImageMaxPixels = 4_000_000;
const defaultImageMaxDimension = 10_000;

export async function extractDocument(document: DocumentImpl, options: ExtractOptions = {}): Promise<ExtractResult> {
  const mode = options.mode ?? "auto";
  if (!["auto", "text", "images", "both"].includes(mode)) {
    throw new PdfFormatError(`Unsupported extraction mode: ${String(mode)}`);
  }
  const pages = documentPages(document, options);
  let text = "";
  let textPages: number[] = [];
  let textTruncated = false;

  if (mode !== "images") {
    const textOptions: TextOptions = {
      pages,
      maxChars: positiveInteger("maxTextChars", options.maxTextChars ?? defaultMaxTextChars),
    };
    const extracted = document.extractText(textOptions);
    text = extracted.text;
    textPages = extracted.pagesProcessed;
    textTruncated = extracted.truncated;
  }

  const shouldRenderImages = mode === "images"
    || mode === "both"
    || (mode === "auto" && text.trim().length < positiveInteger("minTextChars", options.minTextChars ?? defaultMinTextChars));

  const rendered = shouldRenderImages ? await renderImages(document, pages, options.image ?? {}) : { images: [], truncated: false };
  const imagePages = rendered.images.map((image) => image.page);
  const pagesProcessed = uniqueNumbers([...textPages, ...imagePages]);
  return {
    text,
    images: rendered.images,
    pagesProcessed,
    truncated: {
      text: textTruncated,
      images: rendered.truncated,
    },
  };
}

async function renderImages(
  document: DocumentImpl,
  pages: number[],
  image: NonNullable<ExtractOptions["image"]>,
): Promise<{ images: PdfImage[]; truncated: boolean }> {
  const maxPixels = positiveInteger("maxPixels", image.maxPixels ?? defaultImageMaxPixels);
  const maxDimension = positiveInteger("maxDimension", image.maxDimension ?? defaultImageMaxDimension);
  if (image.format !== undefined && image.format !== "png") {
    throw new PdfFormatError(`Unsupported image format: ${String(image.format)}`);
  }
  if (image.dpi !== undefined && image.scale !== undefined) {
    throw new PdfFormatError("image sizing expects at most one of dpi or scale");
  }
  const requestedScale = image.scale !== undefined
    ? positiveFiniteNumber("scale", image.scale)
    : positiveFiniteNumber("dpi", image.dpi ?? 96) / 72;
  const images: PdfImage[] = [];
  let remainingPixels = maxPixels;
  let truncated = false;

  for (const pageNumber of pages) {
    const page = document.page(pageNumber);
    const plan = planImageRender(page.width, page.height, requestedScale, remainingPixels, maxDimension);
    if (!plan) {
      truncated = true;
      break;
    }
    if (plan.capped) {
      truncated = true;
    }
    const bytes = await page.png({
      scale: plan.scale,
      forms: image.forms ?? true,
    });
    const dimensions = pngDimensions(bytes);
    images.push({
      page: pageNumber,
      width: dimensions.width,
      height: dimensions.height,
      bytes,
      mimeType: "image/png",
    });
    remainingPixels -= dimensions.width * dimensions.height;
  }

  if (images.length < pages.length) {
    truncated = true;
  }
  return { images, truncated };
}

function documentPages(document: PdfDocument, options: Pick<ExtractOptions, "pages" | "maxPages">): number[] {
  if (options.pages) {
    const limit = options.maxPages === undefined
      ? options.pages.length
      : positiveInteger("maxPages", options.maxPages);
    const selected = options.pages.slice(0, limit);
    for (const page of selected) {
      document.page(page);
    }
    return selected;
  }
  const maxPages = positiveInteger("maxPages", options.maxPages ?? defaultMaxPages);
  return Array.from({ length: Math.min(document.pageCount, maxPages) }, (_, index) => index + 1);
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)];
}

/** Minimum PNG size for IHDR: 8-byte signature + 8-byte chunk header + 13-byte IHDR data. */
const PNG_IHDR_MIN_BYTES = 24;

/** Read PNG width/height from IHDR. Exported for unit tests. */
export function pngDimensions(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.byteLength < PNG_IHDR_MIN_BYTES) {
    throw new PdfFormatError(
      `PNG buffer too short to read dimensions: ${bytes.byteLength} bytes (need at least ${PNG_IHDR_MIN_BYTES})`,
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
  };
}
