# clawpdf

[![CI](https://github.com/openclaw/clawpdf/actions/workflows/ci.yml/badge.svg)](https://github.com/openclaw/clawpdf/actions/workflows/ci.yml)

Zero-dependency PDFium WebAssembly bindings for Node and browsers.

Docs: <https://clawpdf.dev/>

`clawpdf` loads PDFs, extracts text, renders pages, and encodes PNG fallback
images without runtime dependencies, native addons, postinstall scripts, or a
canvas package.

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

ESM-only. Node 20+ is supported.

## Quick Start

```ts
import { openPdf } from "clawpdf";

await using pdf = await openPdf("report.pdf");

console.log(pdf.pageCount);
console.log(pdf.text({ maxPages: 5 }));

const png = await pdf.page(1).png({ dpi: 144, forms: true });
await fs.promises.writeFile("page-1.png", png);
```

All user-facing page numbers are one-based.

Server code should create one engine and reuse it:

```ts
import { createEngine } from "clawpdf";

await using engine = await createEngine();

const result = await engine.extract(pdfBytes, {
  mode: "auto",
  maxPages: 20,
});
```

## Text-First Extraction

```ts
import { extractPdf } from "clawpdf";
import { toMessageContent } from "clawpdf/adapters";

const result = await extractPdf("report.pdf", {
  mode: "auto",
  minTextChars: 200,
  maxPages: 20,
  image: {
    dpi: 96,
    maxPixels: 4_000_000,
    maxDimension: 10_000,
    forms: true,
  },
});

console.log(result.text);
console.log(result.images); // raw PNG bytes
console.log(toMessageContent(result)); // transport-shaped blocks
```

`auto` always extracts text and renders PNG images only when extracted text is
shorter than `minTextChars`.

## API

Feature docs:

- [Loading PDFs](https://clawpdf.dev/loading.html)
- [Text extraction](https://clawpdf.dev/text-extraction.html)
- [Page rendering](https://clawpdf.dev/page-rendering.html)
- [PNG output](https://clawpdf.dev/png-output.html)
- [Extraction fallback](https://clawpdf.dev/extraction-fallback.html)
- [Password-protected PDFs](https://clawpdf.dev/passwords.html)
- [Browser and bundlers](https://clawpdf.dev/browser-bundlers.html)
- [PDFium provenance](https://clawpdf.dev/pdfium-provenance.html)
- [Package shape](https://clawpdf.dev/package-shape.html)
- [Performance](https://clawpdf.dev/performance.html)
- [API reference](https://clawpdf.dev/api-reference.html)

Core exports:

- `extractPdf(input, options?)`: one-shot extraction with a shared engine.
- `openPdf(input, options?)`: open one document with private lifetime.
- `createEngine(options?)`: create a reusable PDFium engine.
- `releaseExtractEngine()`: dispose the shared extraction engine after in-flight calls finish.
- `encodePng(rgba, { width, height, compress })`: standalone RGBA to PNG.
- `PdfError` subclasses for typed failures.
- `PDFIUM_RELEASE` and `PDFIUM_WASM_SHA256`.

## Performance Snapshot

Local Node benchmark on five sample PDFs, first page rendered at scale `2` with
text extraction and PNG encoding included.

| Sample | previous stack total / RSS / PNG | clawpdf total / RSS / PNG |
| --- | --- | --- |
| Form | 95.4 ms / 174.9 MB / 114,930 B | 38.7 ms / 129.4 MB / 100,629 B |
| Hello | 65.2 ms / 159.7 MB / 41,408 B | 27.2 ms / 124.1 MB / 47,106 B |
| Scientific | 176.9 ms / 202.0 MB / 608,807 B | 66.0 ms / 137.8 MB / 321,122 B |
| Magazine | 519.4 ms / 312.0 MB / 1,616,318 B | 255.9 ms / 179.5 MB / 1,930,947 B |
| Checkmark | 2.6 ms / 128.1 MB / 589 B | 1.1 ms / 83.2 MB / 498 B |

## Package Shape

Runtime dependencies: none.
Release history: see `CHANGELOG.md`.

Published files:

- `dist/index.js`
- `dist/browser.js`
- `dist/adapters/index.js`
- `dist/vendor/pdfium.esm.js`
- `dist/vendor/pdfium.esm.wasm`
- `CHANGELOG.md`
- license/readme/notices

Current vendored binary:

- `pdfium-lib`: `7623`
- WASM SHA-256: `14ca2adbe23b45dea57da28ae2746e376f1cddfb8e2d0b01b71dcc5cf227734e`

## Refresh PDFium

```bash
pnpm download:pdfium
pnpm test
```

To move to a newer `pdfium-lib` release, update the release tag and hashes in:

- `scripts/download-pdfium.mjs`
- `src/constants.ts`
- this README
- `docs/pdfium-provenance.md`

## License

MIT for this wrapper. PDFium has upstream BSD-style and Apache-2.0 notices; see
`THIRD_PARTY_NOTICES.md`.
