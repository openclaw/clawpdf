import { PdfBudgetError, PdfError, PdfFormatError } from "./errors.js";

export type PdfInput = Uint8Array | ArrayBuffer | string | URL | Blob;

export type PdfInputOptions = {
  signal?: AbortSignal;
  fetchTimeoutMs?: number;
  fetchMaxBytes?: number;
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
const defaultFetchMaxBytes = 0;
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
  const maxBytes = resolveFetchMaxBytes(options.fetchMaxBytes);
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
    return await readResponseBytes(url, response, maxBytes);
  } catch (error) {
    // Stop unread error responses as well as failed body reads.
    controller.abort();
    if (error instanceof PdfError) {
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

function resolveFetchMaxBytes(value: number | undefined): number {
  if (value === undefined) {
    return defaultFetchMaxBytes;
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new PdfFormatError(`fetchMaxBytes must be an integer between 0 and ${Number.MAX_SAFE_INTEGER}`);
  }
  return value;
}

async function readResponseBytes(url: URL, response: Response, maxBytes: number): Promise<Uint8Array> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return new Uint8Array(await response.arrayBuffer());
  }
  const declared = parseContentLength(response.headers.get("content-length"));
  if (maxBytes > 0 && declared !== undefined && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new PdfBudgetError(
      "fetchMaxBytes",
      declared,
      `PDF response from ${url.href} exceeds the ${maxBytes}-byte fetch budget`,
    );
  }
  if (maxBytes === 0) {
    return new Uint8Array(await response.arrayBuffer());
  }
  return readCappedBody(url, response, maxBytes);
}

async function readCappedBody(url: URL, response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) {
    return new Uint8Array();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new PdfBudgetError(
          "fetchMaxBytes",
          received,
          `PDF response from ${url.href} exceeds the ${maxBytes}-byte fetch budget`,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return concatUint8(chunks, received);
}

function parseContentLength(header: string | null): number | undefined {
  if (header === null || header === "") {
    return undefined;
  }
  if (!/^\d+$/.test(header)) {
    return undefined;
  }
  // Larger decimal values (including Infinity) exceed every supported budget.
  return Number(header);
}

function concatUint8(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
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
