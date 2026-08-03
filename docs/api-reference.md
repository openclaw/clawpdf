---
title: API Reference
description: Exported ClawPDF API surface.
---

# API Reference

## Exports

```ts
export {
  createEngine,
  encodePng,
  extractPdf,
  openPdf,
  releaseExtractEngine,
  PdfError,
  PdfPasswordError,
  PdfFormatError,
  PdfSecurityError,
  PdfPageRangeError,
  PdfBudgetError,
  PdfDestroyedError,
  PDFIUM_RELEASE,
  PDFIUM_WASM_SHA256,
};
```

Types exported from the package include `PdfInput`, `PdfEngine`, `PdfDocument`,
`PdfPage`, `PdfMetadata`, `RenderOptions`, `ExtractOptions`, `ExtractResult`,
and `PdfImage`.

## Inputs

`PdfInput` accepts `Uint8Array`, `ArrayBuffer`, Node file paths, URLs, and
`Blob`.

In Node, string inputs are treated as absolute URLs when they parse as
`http:`, `https:`, `file:`, or `data:` URLs. Other strings are file paths.
Missing files throw `PdfFormatError` with the original error as `cause`.

In browsers, string inputs must parse as URLs. Path-like strings throw
`PdfFormatError`.

Remote URL options accepted by `openPdf`, `engine.open`, `extractPdf`, and
`engine.extract`:

- `fetchTimeoutMs?: number`: total HTTP(S) response deadline, default `30000`;
  use `0` to disable it.
- `signal?: AbortSignal`: caller-controlled cancellation.

## `createEngine(options?)`

Returns `Promise<PdfEngine>`.

Options:

- `wasmBinary?: ArrayBuffer`
- `wasmUrl?: string`
- `instantiateWasm?: LoadPdfiumOptions["instantiateWasm"]`
- `maxRenderPixels?: number`

`PdfEngine` methods:

- `open(input, options?)`: open one PDF and return `Promise<PdfDocument>`.
- `extract(input, options?)`: open, extract, and close one PDF.
- `destroy()`: close open documents and release PDFium.
- `pdfiumRelease`: current `pdfium-lib` release.
- `wasmSha256`: current WASM SHA-256.

`PdfEngine` implements `Symbol.asyncDispose`.

## `openPdf(input, options?)`

Opens one document with a private engine. Disposing the document also disposes
that private engine.

```ts
await using pdf = await openPdf("report.pdf");
console.log(pdf.text());
```

Options:

- `password?: string`
- `fetchTimeoutMs?: number`
- `signal?: AbortSignal`

## `PdfDocument`

- `pageCount`: number of pages.
- `metadata`: document metadata.
- `page(pageNumber)`: return one one-based `PdfPage`.
- `pages({ from, to })`: iterate one-based pages.
- `text({ pages, maxPages, maxChars })`: extract text from selected pages.
- `extract(options?)`: extract text and optional fallback images.
- `destroy()`: release PDF document memory.

`PdfDocument` implements `Symbol.dispose` and `Symbol.asyncDispose`.

## `PdfPage`

- `index`: one-based page number.
- `width` and `height`: page size in points.
- `rotation`: embedded rotation.
- `text()`: page text.
- `render(options?)`: RGBA bitmap.
- `png(options?)`: compressed PNG bytes.
- `pngSync(options?)`: stored-zlib PNG bytes.

## Extraction

`extractPdf(input, options?)` uses a shared engine. Call
`releaseExtractEngine()` when CLI or test code wants to release that shared
engine after in-flight extractions finish.

Options:

- `mode?: "auto" | "text" | "images" | "both"`
- `password?: string`
- `fetchTimeoutMs?: number`
- `signal?: AbortSignal`
- `pages?: number[]`
- `maxPages?: number`, applied to explicit `pages` only when provided
- `minTextChars?: number`
- `maxTextChars?: number`
- `engine?: PdfEngine`
- `image?: { dpi?: number; scale?: number; maxPixels?: number; maxDimension?: number; forms?: boolean; format?: "png" }`

`ExtractResult`:

```ts
type ExtractResult = {
  text: string;
  images: PdfImage[];
  pagesProcessed: number[];
  truncated: {
    text: boolean;
    images: boolean;
  };
};
```

Images contain raw PNG bytes, not base64.

## Rendering

Render sizing accepts zero or one of `dpi`, `scale`, `width`, and `height`.
Omitting all size fields defaults to `{ dpi: 96 }`.

Options:

- `dpi`: points are scaled from a 72 DPI baseline.
- `scale`: direct page scale.
- `width`: target pixel width.
- `height`: target pixel height.
- `background`: `"white"` or `"transparent"`.
- `forms`: render AcroForm widgets.
- `rotate`: additive rotation in degrees.

Rendered pages are capped before allocation.

## PNG Encoding

```ts
encodePng(rgba, { width, height, compress });
```

`compress` defaults to `true` and returns `Promise<Uint8Array>`. With
`compress: false`, the encoder returns `Uint8Array` synchronously.

## Adapters

Transport-shaped helpers live in `clawpdf/adapters`:

```ts
import { toDataUrls, toMessageContent } from "clawpdf/adapters";
```

`toMessageContent(result)` returns text and Anthropic-style image content
blocks. `toDataUrls(result)` returns PNG data URLs.

## Errors

Every public API failure throws a `PdfError` subclass. Use
`error instanceof PdfError` to catch all ClawPDF errors.

- `PdfPasswordError`: missing or incorrect PDF password.
- `PdfFormatError`: invalid input, missing path, fetch failure, or malformed PDF.
- `PdfSecurityError`: unsupported PDF security handler.
- `PdfPageRangeError`: requested page is outside the document.
- `PdfBudgetError`: render or extraction budget exceeded.
- `PdfDestroyedError`: API used after destroy.
