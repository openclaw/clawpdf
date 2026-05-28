# clawpdf

[![CI](https://github.com/openclaw/clawpdf/actions/workflows/ci.yml/badge.svg)](https://github.com/openclaw/clawpdf/actions/workflows/ci.yml)

Zero-dependency PDFium WebAssembly bindings for Node and browsers.

`clawpdf` is intentionally small: load a PDF, extract text, render pages to RGBA,
or encode rendered pages as PNGs. It ships the PDFium WASM binary in the package
and has no runtime dependencies, native addons, postinstall scripts, or canvas
dependency.

## Why

OpenClaw needs a predictable local PDF path:

- text extraction before model fallback
- page rendering when a PDF has little extractable text
- PNG output for multimodal model input
- one dependency with no transitive package tree
- current vendored PDFium provenance

This package currently vendors `pdfium-lib` release `7623`.

## Install

```bash
npm install clawpdf
```

ESM-only. Node 20+ is supported. Browsers and bundlers can pass `wasmUrl` or
`wasmBinary` explicitly.

## Quick Start

```ts
import { loadClawPDF } from "clawpdf";

const library = await loadClawPDF();

try {
  const document = library.loadDocument(await fs.promises.readFile("report.pdf"));

  try {
    console.log(document.pageCount);
    console.log(document.extractText({ maxPages: 5 }));

    const page = await document.renderPagePngCompressed(0, { scale: 2, renderForms: true });
    await fs.promises.writeFile("page-1.png", page.png);
  } finally {
    document.destroy();
  }
} finally {
  library.destroy();
}
```

PDF page indexes in the document API are zero-based. `extractContent` accepts
one-based `pageNumbers` because that matches user-facing PDF page numbers.

## Text-First Extraction

```ts
import { extractPdfContent } from "clawpdf";

const result = await extractPdfContent(pdfBytes, {
  maxPages: 20,
  maxPixels: 4_000_000,
  minTextChars: 200,
});

console.log(result.text);
console.log(result.images); // PNG base64 pages only when text was too short
```

This mirrors the OpenClaw fallback flow:

1. Extract text from selected pages.
2. If enough text was found, return text only.
3. Otherwise render selected pages within a pixel budget and return PNG images.

## API

### `loadClawPDF(options?)`

Loads PDFium and returns a `ClawPDF` library handle.

Options:

- `wasmUrl`: URL/path passed to the PDFium Emscripten loader.
- `wasmBinary`: raw WASM bytes.
- `instantiateWasm`: custom Emscripten instantiate hook.

Node can load the packaged `dist/vendor/pdfium.wasm` automatically.

### `ClawPDF`

- `loadDocument(bytes, password?)`: returns `PdfDocument`.
- `destroy()`: releases the PDFium library.
- `pdfiumRelease`: current vendored `pdfium-lib` release tag.
- `wasmSha256`: SHA-256 of the vendored WASM.

### `PdfDocument`

- `pageCount`: number of pages.
- `getPageText(pageIndex)`: text for one zero-based page.
- `extractText({ maxPages, pageNumbers })`: text for selected pages.
- `renderPage(pageIndex, options)`: RGBA bitmap.
- `renderPagePng(pageIndex, options)`: sync PNG bytes with stored zlib blocks.
- `renderPagePngCompressed(pageIndex, options)`: compressed PNG bytes.
- `extractContent(options)`: sync text-first extraction with stored-PNG image fallback.
- `extractContentCompressed(options)`: async text-first extraction with compressed-PNG image fallback.
- `destroy()`: releases PDF document memory.

The top-level async `extractPdfContent(...)` helper uses compressed PNG output.

Render options:

- `scale`: multiplier, default `1`.
- `width` / `height`: point-size override before scaling.
- `renderForms`: render AcroForm widgets.
- `transparent`: transparent page background.

## Package Shape

Runtime dependencies: none.

Published files:

- `dist/index.js`
- `dist/index.d.ts`
- `dist/vendor/pdfium.esm.js`
- `dist/vendor/pdfium.esm.wasm`
- license/readme/notices

Current vendored binary:

- `pdfium-lib`: `7623`
- `src/vendor/pdfium.wasm` SHA-256:
  `14ca2adbe23b45dea57da28ae2746e376f1cddfb8e2d0b01b71dcc5cf227734e`

## Refresh PDFium

```bash
pnpm download:pdfium
pnpm test
```

`scripts/download-pdfium.mjs` downloads the pinned `wasm.tgz` asset, verifies the
archive hash and WASM hash, then updates `src/vendor`.

To move to a newer `pdfium-lib` release, update the release tag and hashes in:

- `scripts/download-pdfium.mjs`
- `src/constants.ts`
- this README

## Prior Art

- [`@hyzyla/pdfium`](https://github.com/hyzyla/pdfium): friendly TypeScript API
  around `pdfium-lib`.
- [`pdfium-lib`](https://github.com/paulocoutinhox/pdfium-lib): PDFium builds
  for multiple targets, including WASM.
- [`pdfjs-dist`](https://github.com/mozilla/pdf.js): current OpenClaw PDF parser
  path before this experiment.

`clawpdf` is narrower than `@hyzyla/pdfium`: no image-object API, no worker
client, no docs site runtime, no runtime dependencies. The goal is a boring
OpenClaw-grade extraction/rendering primitive.

## License

MIT for this wrapper. PDFium has upstream BSD-style and Apache-2.0 notices; see
`THIRD_PARTY_NOTICES.md`.
