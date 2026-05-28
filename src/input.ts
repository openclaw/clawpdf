import { PdfFormatError } from "./errors.js";

export type PdfInput = Uint8Array | ArrayBuffer | string | URL | Blob;

export async function normalizePdfInput(input: PdfInput): Promise<Uint8Array> {
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
    return readUrl(input);
  }
  if (typeof input === "string") {
    return readStringInput(input);
  }
  throw new PdfFormatError("Unsupported PDF input type");
}

async function readStringInput(input: string): Promise<Uint8Array> {
  const url = parseAbsoluteUrl(input);
  if (url && isSupportedUrlProtocol(url.protocol)) {
    return readUrl(url);
  }
  if (url && !isNodeRuntime()) {
    throw new PdfFormatError(`Unsupported PDF URL protocol: ${url.protocol}`);
  }
  if (!isNodeRuntime()) {
    throw new PdfFormatError("Browser string PDF inputs must be URLs");
  }
  return readNodeFile(input);
}

async function readUrl(url: URL): Promise<Uint8Array> {
  if (url.protocol === "file:" && isNodeRuntime()) {
    const { fileURLToPath } = await import("node:url");
    return readNodeFile(fileURLToPath(url));
  }
  if (!["http:", "https:", "data:"].includes(url.protocol)) {
    throw new PdfFormatError(`Unsupported PDF URL protocol: ${url.protocol}`);
  }
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new PdfFormatError(`Failed to fetch PDF from ${url.href}`, { cause: error });
  }
  if (!response.ok) {
    throw new PdfFormatError(`Failed to fetch PDF from ${url.href}: ${response.status} ${response.statusText}`);
  }
  return new Uint8Array(await response.arrayBuffer());
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
