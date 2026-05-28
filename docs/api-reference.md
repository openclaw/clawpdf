---
title: API Reference
description: Exported ClawPDF API surface.
---

# API Reference

## Exports

```ts
export {
  encodePngRgba,
  encodePngRgbaCompressed,
  extractPdfContent,
  loadClawPDF,
  PDFIUM_RELEASE,
  PDFIUM_WASM_SHA256,
};
```

## `loadClawPDF(options?)`

Returns a `Promise<ClawPDF>`.

Options:

- `wasmBinary?: ArrayBuffer`
- `wasmUrl?: string`
- `instantiateWasm?: LoadPdfiumOptions["instantiateWasm"]`

## `ClawPDF`

- `loadDocument(input, password?)`: load PDF bytes.
- `destroy()`: release PDFium library resources.
- `pdfiumRelease`: current `pdfium-lib` release.
- `wasmSha256`: current WASM SHA-256.

## `PdfDocument`

- `pageCount`: number of pages.
- `getPageText(pageIndex)`: text from one zero-based page.
- `extractText({ maxPages, pageNumbers })`: text from selected pages.
- `renderPage(pageIndex, options)`: RGBA bitmap.
- `renderPagePng(pageIndex, options)`: sync PNG bytes.
- `renderPagePngCompressed(pageIndex, options)`: compressed PNG bytes.
- `extractContent(options)`: sync text-first extraction with stored PNG fallback.
- `extractContentCompressed(options)`: async text-first extraction with compressed PNG fallback.
- `destroy()`: release PDF document resources.

## `extractPdfContent(input, options?)`

High-level async helper. It loads PDFium, opens one document, runs compressed
text-first extraction, and tears everything down.

Options:

- `maxPages?: number`
- `maxDimension?: number`
- `maxPixels?: number`
- `minTextChars?: number`
- `pageNumbers?: number[]`
- `password?: string`
- `renderScale?: number`

## PNG Encoders

```ts
encodePngRgba(width, height, rgba): Uint8Array;
encodePngRgbaCompressed(width, height, rgba): Promise<Uint8Array>;
```

Both require `rgba.byteLength === width * height * 4`.

Numeric render and extraction limits must be finite. Direct page renders are
capped at 100,000,000 pixels before allocation.
