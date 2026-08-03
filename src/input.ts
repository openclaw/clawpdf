import { PdfFormatError } from "./errors.js";

export type PdfInput = Uint8Array | ArrayBuffer | string | URL | Blob;

export type PdfInputOptions = {
  signal?: AbortSignal;
  fetchTimeoutMs?: number;
};

export async function normalizePdfInput(input: PdfInput, options: PdfInputOptions = {}): Promise<Uint8Array> {
  if (input instanceof Uint8Array) {
    return input;
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  if (typeof Blob !== "undefined" && input instanceof Blob) {
    return new Uint8Array(await input.arrayBuffer());
  }
  if (input instanceof URL) {
    return readUrl(input, options);
  }
  if (typeof input === "string") {
    return readStringInput(input, options);
  }
  throw new PdfFormatError("Unsupported PDF input type");
}

async function readStringInput(input: string, options: PdfInputOptions): Promise<Uint8Array> {
  const url = parseAbsoluteUrl(input);
  if (url && isSupportedUrlProtocol(url.protocol)) {
    return readUrl(url, options);
  }
  if (url && !isNodeRuntime()) {
    throw new PdfFormatError(`Unsupported PDF URL protocol: ${url.protocol}`);
  }
  if (!isNodeRuntime()) {
    throw new PdfFormatError("Browser string PDF inputs must be URLs");
  }
  return readNodeFile(input);
}

const defaultFetchTimeoutMs = 30_000;
const maxTimerMs = 2_147_483_647;

async function readUrl(url: URL, options: PdfInputOptions): Promise<Uint8Array> {
  if (url.protocol === "file:" && isNodeRuntime()) {
    const { fileURLToPath } = await import("node:url");
    return readNodeFile(fileURLToPath(url));
  }
  if (!["http:", "https:", "data:"].includes(url.protocol)) {
    throw new PdfFormatError(`Unsupported PDF URL protocol: ${url.protocol}`);
  }
  const timeoutMs = resolveFetchTimeout(options.fetchTimeoutMs);
  const controller = new AbortController();
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const abortFromCaller = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) {
    abortFromCaller();
  } else {
    options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  }
  if (timeoutMs > 0 && !controller.signal.aborted) {
    timeout = setTimeout(() => {
      if (controller.signal.aborted) {
        return;
      }
      timedOut = true;
      controller.abort();
    }, timeoutMs);
  }

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new PdfFormatError(`Failed to fetch PDF from ${url.href}: ${response.status} ${response.statusText}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    if (error instanceof PdfFormatError) {
      throw error;
    }
    if (timedOut) {
      throw new PdfFormatError(
        `Timed out fetching PDF from ${url.href} after ${timeoutMs}ms`,
        { cause: error },
      );
    }
    if (options.signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw new PdfFormatError(`Aborted fetching PDF from ${url.href}`, { cause: error });
    }
    throw new PdfFormatError(`Failed to fetch PDF from ${url.href}`, { cause: error });
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

function resolveFetchTimeout(value: number | undefined): number {
  if (value === undefined) {
    return defaultFetchTimeoutMs;
  }
  if (!Number.isSafeInteger(value) || value < 0 || value > maxTimerMs) {
    throw new PdfFormatError(`fetchTimeoutMs must be an integer between 0 and ${maxTimerMs}`);
  }
  return value;
}

function isSupportedUrlProtocol(protocol: string): boolean {
  return ["file:", "http:", "https:", "data:"].includes(protocol);
}

async function readNodeFile(filePath: string): Promise<Uint8Array> {
  try {
    const { readFile } = await import("node:fs/promises");
    return new Uint8Array(await readFile(filePath));
  } catch (error) {
    throw new PdfFormatError(`Failed to read PDF file: ${filePath}`, { cause: error });
  }
}

function parseAbsoluteUrl(input: string): URL | undefined {
  if (!/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(input)) {
    return undefined;
  }
  try {
    return new URL(input);
  } catch {
    return undefined;
  }
}

function isNodeRuntime(): boolean {
  return typeof process === "object" && Boolean(process.versions?.node);
}
