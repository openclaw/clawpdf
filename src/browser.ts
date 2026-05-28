import { createEngine as createCoreEngine } from "./index.js";
import { type EngineOptions, type OpenPdfOptions } from "./engine.js";
import { type ExtractOptions, type ExtractResult } from "./extract.js";
import { type PdfInput } from "./input.js";

export * from "./index.js";

const browserWasmUrl = new URL("./vendor/pdfium.esm.wasm", import.meta.url).href;
let sharedEngine: Promise<import("./engine.js").PdfEngine> | undefined;
let sharedInFlight = 0;
let sharedReleaseRequested = false;

export async function createEngine(options: EngineOptions = {}): Promise<import("./engine.js").PdfEngine> {
  return createCoreEngine({
    wasmUrl: browserWasmUrl,
    ...options,
  });
}

export async function openPdf(
  input: PdfInput,
  options: OpenPdfOptions = {},
): Promise<import("./engine.js").PdfDocument> {
  const engine = await createEngine();
  try {
    return await (engine as import("./engine.js").EngineImpl).openPrivate(input, options);
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
