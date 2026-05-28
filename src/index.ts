import { createEngineImpl } from "./engine.js";
import { type ExtractOptions, type ExtractResult } from "./extract.js";
import { type PdfInput } from "./input.js";
import { encodePngRgba, encodePngRgbaCompressed } from "./png.js";

export { PDFIUM_RELEASE, PDFIUM_WASM_SHA256 } from "./constants.js";
export {
  PdfBudgetError,
  PdfDestroyedError,
  PdfError,
  PdfFormatError,
  PdfPageRangeError,
  PdfPasswordError,
  PdfSecurityError,
} from "./errors.js";
export type { EngineOptions, OpenPdfOptions, PdfDocument, PdfEngine } from "./engine.js";
export type { ExtractMode, ExtractOptions, ExtractResult, PdfImage } from "./extract.js";
export type { PdfInput } from "./input.js";
export type { PdfMetadata } from "./document.js";
export type { PdfPage } from "./page.js";
export type { RenderOptions } from "./render.js";
export type { InlineImageMode, InlineImageProtocol, InlineImage } from "./inline.js";
export { renderInlineImages, resolveInlineImageProtocol } from "./inline.js";

export type EncodePngOptions = {
  width: number;
  height: number;
  compress?: boolean;
};

let sharedEngine: Promise<import("./engine.js").PdfEngine> | undefined;
let sharedInFlight = 0;
let sharedReleaseRequested = false;

export async function createEngine(options: import("./engine.js").EngineOptions = {}): Promise<import("./engine.js").PdfEngine> {
  return createEngineImpl(options);
}

export async function openPdf(
  input: PdfInput,
  options: import("./engine.js").OpenPdfOptions = {},
): Promise<import("./engine.js").PdfDocument> {
  const engine = await createEngineImpl();
  try {
    return await engine.openPrivate(input, options);
  } catch (error) {
    await engine.destroy();
    throw error;
  }
}

export async function extractPdf(input: PdfInput, options: ExtractOptions = {}): Promise<ExtractResult> {
  if (options.engine) {
    return options.engine.extract(input, withoutEngine(options));
  }

  sharedInFlight += 1;
  try {
    const engine = await getSharedEngine();
    return await engine.extract(input, options);
  } finally {
    sharedInFlight -= 1;
    if (sharedReleaseRequested && sharedInFlight === 0) {
      await disposeSharedEngine();
    }
  }
}

export async function releaseExtractEngine(): Promise<void> {
  sharedReleaseRequested = true;
  if (sharedInFlight === 0) {
    await disposeSharedEngine();
  }
}

export function encodePng(
  rgba: Uint8Array,
  options: EncodePngOptions & { compress: false },
): Uint8Array;
export function encodePng(
  rgba: Uint8Array,
  options: EncodePngOptions & { compress?: true },
): Promise<Uint8Array>;
export function encodePng(
  rgba: Uint8Array,
  options: EncodePngOptions,
): Promise<Uint8Array> | Uint8Array {
  if (options.compress === false) {
    return encodePngRgba(options.width, options.height, rgba);
  }
  return encodePngRgbaCompressed(options.width, options.height, rgba);
}

async function getSharedEngine(): Promise<import("./engine.js").PdfEngine> {
  if (!sharedEngine) {
    sharedReleaseRequested = false;
    let nextEngine: Promise<import("./engine.js").PdfEngine>;
    nextEngine = createEngine().catch((error: unknown) => {
      if (sharedEngine === nextEngine) {
        sharedEngine = undefined;
      }
      throw error;
    });
    sharedEngine = nextEngine;
  }
  return sharedEngine;
}

async function disposeSharedEngine(): Promise<void> {
  const engine = sharedEngine;
  sharedEngine = undefined;
  sharedReleaseRequested = false;
  if (engine) {
    await (await engine).destroy();
  }
}

function withoutEngine(options: ExtractOptions): ExtractOptions {
  const { engine: _engine, ...rest } = options;
  return rest;
}
