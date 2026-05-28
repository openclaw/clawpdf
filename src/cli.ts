#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ExtractMode,
  type ExtractOptions,
  type ExtractResult,
  type RenderOptions,
  PdfBudgetError,
  PdfError,
  PdfFormatError,
  PdfPasswordError,
  PdfSecurityError,
  createEngine,
  extractPdf,
  releaseExtractEngine,
} from "./index.js";

type Command = "extract" | "render";

type ParsedArgs = {
  command: Command;
  input?: string;
  output?: string;
  outputDir?: string;
  json: boolean;
  plain: boolean;
  quiet: boolean;
  verbose: boolean;
  noInput: boolean;
  help: boolean;
  version: boolean;
  password?: string;
  passwordFile?: string;
  mode?: ExtractMode;
  pages?: number[];
  page?: number;
  maxPages?: number;
  maxTextChars?: number;
  minTextChars?: number;
  dpi?: number;
  scale?: number;
  maxPixels?: number;
  maxDimension?: number;
  forms?: boolean;
};

const defaultCliMaxPages = 20;
const maxExplicitPageList = 100_000;

class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
    this.name = "CliError";
  }
}

const helpText = `Usage:
  clawpdf [flags] <file|->
  clawpdf extract [flags] <file|->
  clawpdf render [flags] <file|-> --page <n>

Examples:
  clawpdf report.pdf
  cat report.pdf | clawpdf -
  clawpdf report.pdf --json
  clawpdf extract report.pdf --mode both --pages 1,3-5 --json
  clawpdf render report.pdf --page 1 > page.png
  clawpdf render report.pdf --page 1 -o page.png

Global flags:
  -h, --help                 Show help
  --version                  Print version
  --json                     Print structured JSON
  --plain                    Print plain text output
  -q, --quiet                Suppress non-error diagnostics
  -v, --verbose              Print verbose diagnostics to stderr
  --no-color                 Disable color output
  --no-input                 Never prompt for input

Extraction flags:
  --password <value>         PDF password
  --password-file <path>     Read PDF password from file
  --mode <mode>              auto, text, images, or both (default: text)
  --pages <list>             Page list, e.g. 1,3-5
  --max-pages <n>            Maximum pages to process (default: 20)
  --max-text-chars <n>       Maximum text characters
  --min-text-chars <n>       Minimum text before auto image fallback
  --output-dir <dir>         Write extracted PNG images to directory

Render flags:
  --page <n>                 One-based page number
  -o, --output <file>        Write PNG to file instead of stdout
  --dpi <n>                  Render DPI
  --scale <n>                Render scale
  --forms, --no-forms        Enable or disable form rendering
`;

export async function main(argv = process.argv.slice(2)): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
    if (parsed.help) {
      process.stdout.write(helpText);
      return 0;
    }
    if (parsed.version) {
      process.stdout.write(`${await readPackageVersion()}\n`);
      return 0;
    }

    const input = await readInput(parsed);
    const password = await readPassword(parsed);
    if (parsed.command === "render") {
      await runRender(input, parsed, password);
    } else {
      await runExtract(input, parsed, password);
    }
    return 0;
  } catch (error) {
    const exitCode = errorExitCode(error);
    process.stderr.write(`${errorMessage(error)}\n`);
    return exitCode;
  } finally {
    await releaseExtractEngine();
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    command: "extract",
    json: false,
    plain: false,
    quiet: false,
    verbose: false,
    noInput: false,
    help: false,
    version: false,
  };
  const args = [...argv];
  let pagesValue: string | undefined;
  const first = args[0];
  if (first === "help") {
    parsed.help = true;
    return parsed;
  }
  if (first === "extract" || first === "render") {
    parsed.command = first;
    args.shift();
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    switch (arg) {
      case "-h":
      case "--help":
        parsed.help = true;
        break;
      case "--version":
        parsed.version = true;
        break;
      case "--json":
        parsed.json = true;
        break;
      case "--plain":
        parsed.plain = true;
        break;
      case "-q":
      case "--quiet":
        parsed.quiet = true;
        break;
      case "-v":
      case "--verbose":
        parsed.verbose = true;
        break;
      case "--no-input":
        parsed.noInput = true;
        break;
      case "--no-color":
        break;
      case "--password":
        parsed.password = nextValue(args, ++index, arg);
        break;
      case "--password-file":
        parsed.passwordFile = nextValue(args, ++index, arg);
        break;
      case "--mode":
        parsed.mode = parseMode(nextValue(args, ++index, arg));
        break;
      case "--pages":
        pagesValue = nextValue(args, ++index, arg);
        break;
      case "--page":
        parsed.page = parsePositiveInteger("page", nextValue(args, ++index, arg));
        break;
      case "--max-pages":
        parsed.maxPages = parsePositiveInteger("max-pages", nextValue(args, ++index, arg));
        break;
      case "--max-text-chars":
        parsed.maxTextChars = parsePositiveInteger("max-text-chars", nextValue(args, ++index, arg));
        break;
      case "--min-text-chars":
        parsed.minTextChars = parsePositiveInteger("min-text-chars", nextValue(args, ++index, arg));
        break;
      case "--dpi":
        parsed.dpi = parsePositiveNumber("dpi", nextValue(args, ++index, arg));
        break;
      case "--scale":
        parsed.scale = parsePositiveNumber("scale", nextValue(args, ++index, arg));
        break;
      case "--max-pixels":
        parsed.maxPixels = parsePositiveInteger("max-pixels", nextValue(args, ++index, arg));
        break;
      case "--max-dimension":
        parsed.maxDimension = parsePositiveInteger("max-dimension", nextValue(args, ++index, arg));
        break;
      case "--forms":
        parsed.forms = true;
        break;
      case "--no-forms":
        parsed.forms = false;
        break;
      case "-o":
      case "--output":
        parsed.output = nextValue(args, ++index, arg);
        break;
      case "--output-dir":
      case "--outdir":
        parsed.outputDir = nextValue(args, ++index, arg);
        break;
      default:
        if (arg.startsWith("-") && arg !== "-") {
          throw new CliError(`Unknown flag: ${arg}`, 2);
        }
        if (parsed.input !== undefined) {
          throw new CliError(`Unexpected extra argument: ${arg}`, 2);
        }
        parsed.input = arg;
        break;
    }
  }

  if (parsed.help || parsed.version) {
    return parsed;
  }
  if (parsed.json && parsed.plain) {
    throw new CliError("Use at most one of --json or --plain", 2);
  }
  if (parsed.quiet && parsed.verbose) {
    throw new CliError("Use at most one of --quiet or --verbose", 2);
  }
  if (parsed.command === "render" && parsed.page === undefined) {
    throw new CliError("render requires --page <n>", 2);
  }
  if (parsed.maxPages !== undefined && parsed.maxPages > maxExplicitPageList) {
    throw new CliError(`--max-pages cannot exceed ${maxExplicitPageList}`, 2);
  }
  if (parsed.dpi !== undefined && parsed.scale !== undefined) {
    throw new CliError("Use at most one of --dpi or --scale", 2);
  }
  if (parsed.password !== undefined && parsed.passwordFile !== undefined) {
    throw new CliError("Use at most one of --password or --password-file", 2);
  }
  if (pagesValue !== undefined) {
    const pageLimit = parsed.maxPages ?? defaultCliMaxPages;
    parsed.pages = parsePages(pagesValue, pageLimit);
    if (parsed.maxPages === undefined) {
      parsed.maxPages = pageLimit;
    }
  }
  return parsed;
}

function nextValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (value === undefined || (value.startsWith("-") && value !== "-")) {
    throw new CliError(`${flag} requires a value`, 2);
  }
  return value;
}

function parseMode(value: string): ExtractMode {
  if (value === "auto" || value === "text" || value === "images" || value === "both") {
    return value;
  }
  throw new CliError(`Unsupported mode: ${value}`, 2);
}

function parsePages(value: string, limit: number): number[] {
  const pages: number[] = [];
  for (const part of value.split(",")) {
    if (pages.length >= limit) {
      break;
    }
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    const range = /^(\d+)-(\d+)$/.exec(trimmed);
    if (range) {
      const start = parsePositiveInteger("pages", range[1] ?? "");
      const end = parsePositiveInteger("pages", range[2] ?? "");
      if (end < start) {
        throw new CliError(`Invalid page range: ${trimmed}`, 2);
      }
      for (let page = start; page <= end && pages.length < limit; page += 1) {
        pages.push(page);
      }
      continue;
    }
    pages.push(parsePositiveInteger("pages", trimmed));
    if (pages.length > maxExplicitPageList) {
      throw new CliError(`--pages expands past ${maxExplicitPageList} entries; use --max-pages to cap it`, 2);
    }
  }
  if (!pages.length) {
    throw new CliError("--pages requires at least one page", 2);
  }
  return [...new Set(pages)];
}

function parsePositiveInteger(name: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CliError(`${name} must be a positive integer`, 2);
  }
  return parsed;
}

function parsePositiveNumber(name: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new CliError(`${name} must be a positive number`, 2);
  }
  return parsed;
}

async function readInput(parsed: ParsedArgs): Promise<string | Uint8Array> {
  if (parsed.input && parsed.input !== "-") {
    return parsed.input;
  }
  if (process.stdin.isTTY) {
    throw new CliError("Missing input file. Pass <file>, -, or pipe PDF bytes on stdin.", 2);
  }
  return readStdin();
}

async function readStdin(): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function readPassword(parsed: ParsedArgs): Promise<string | undefined> {
  if (parsed.password !== undefined) {
    return parsed.password;
  }
  if (parsed.passwordFile !== undefined) {
    return (await readFile(parsed.passwordFile, "utf8")).replace(/\r?\n$/, "");
  }
  return undefined;
}

async function runExtract(input: string | Uint8Array, parsed: ParsedArgs, password: string | undefined): Promise<void> {
  const options: ExtractOptions = { mode: parsed.mode ?? "text" };
  if (password !== undefined) options.password = password;
  if (parsed.pages !== undefined) options.pages = parsed.pages;
  if (parsed.maxPages !== undefined) options.maxPages = parsed.maxPages;
  if (parsed.maxTextChars !== undefined) options.maxTextChars = parsed.maxTextChars;
  if (parsed.minTextChars !== undefined) options.minTextChars = parsed.minTextChars;
  const image = extractionImageOptions(parsed);
  if (image) options.image = image;

  const result = await extractPdf(input, options);
  if (parsed.outputDir) {
    await writeImages(parsed.outputDir, result);
  }
  if (parsed.json) {
    process.stdout.write(`${JSON.stringify(jsonResult(result), null, 2)}\n`);
    return;
  }
  process.stdout.write(result.text);
  if (result.text && !result.text.endsWith("\n")) {
    process.stdout.write("\n");
  }
}

function extractionImageOptions(parsed: ParsedArgs): NonNullable<ExtractOptions["image"]> | undefined {
  const image: NonNullable<ExtractOptions["image"]> = {};
  if (parsed.dpi !== undefined) image.dpi = parsed.dpi;
  if (parsed.scale !== undefined) image.scale = parsed.scale;
  if (parsed.maxPixels !== undefined) image.maxPixels = parsed.maxPixels;
  if (parsed.maxDimension !== undefined) image.maxDimension = parsed.maxDimension;
  if (parsed.forms !== undefined) image.forms = parsed.forms;
  return Object.keys(image).length ? image : undefined;
}

async function writeImages(outputDir: string, result: ExtractResult): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  await Promise.all(
    result.images.map((image) => writeFile(join(outputDir, `page-${image.page}.png`), image.bytes)),
  );
}

function jsonResult(result: ExtractResult): object {
  return {
    text: result.text,
    pagesProcessed: result.pagesProcessed,
    truncated: result.truncated,
    images: result.images.map((image) => ({
      page: image.page,
      width: image.width,
      height: image.height,
      mimeType: image.mimeType,
      base64: Buffer.from(image.bytes).toString("base64"),
    })),
  };
}

async function runRender(input: string | Uint8Array, parsed: ParsedArgs, password: string | undefined): Promise<void> {
  const openOptions: { password?: string } = {};
  if (password !== undefined) {
    openOptions.password = password;
  }
  if (parsed.maxDimension !== undefined) {
    throw new CliError("--max-dimension is only supported for extraction image fallback", 2);
  }
  const engineOptions: { maxRenderPixels?: number } = {};
  if (parsed.maxPixels !== undefined) {
    engineOptions.maxRenderPixels = parsed.maxPixels;
  }
  const engine = await createEngine(engineOptions);
  try {
    const pdf = await engine.open(input, openOptions);
    try {
      const renderOptions: RenderOptions = {};
      if (parsed.dpi !== undefined) renderOptions.dpi = parsed.dpi;
      if (parsed.scale !== undefined) renderOptions.scale = parsed.scale;
      if (parsed.forms !== undefined) renderOptions.forms = parsed.forms;
      const png = await pdf.page(parsed.page ?? 1).png(renderOptions);
      if (parsed.output) {
        await writeFile(parsed.output, png);
        return;
      }
      process.stdout.write(png);
    } finally {
      pdf.destroy();
    }
  } finally {
    await engine.destroy();
  }
}

async function readPackageVersion(): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  const packageJson = JSON.parse(await readFile(join(here, "..", "package.json"), "utf8")) as { version?: string };
  return packageJson.version ?? "0.0.0";
}

function errorExitCode(error: unknown): number {
  if (error instanceof CliError) return error.exitCode;
  if (error instanceof PdfPasswordError) return 4;
  if (error instanceof PdfBudgetError) return 5;
  if (error instanceof PdfFormatError) return 3;
  if (error instanceof PdfSecurityError) return 1;
  if (error instanceof PdfError) return 1;
  return 1;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isCliEntrypoint(): boolean {
  if (!process.argv[1]) {
    return false;
  }
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return fileURLToPath(import.meta.url) === process.argv[1];
  }
}

if (isCliEntrypoint()) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
