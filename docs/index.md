---
title: Overview
description: Zero-dependency PDFium WebAssembly bindings for text extraction and page rendering.
---

# ClawPDF

ClawPDF is a small PDFium WebAssembly wrapper for Node and browsers. It loads
PDF input, extracts text, renders pages, and produces PNG fallback images
without pulling in native canvas packages, postinstall scripts, or runtime
dependencies.

It is built for OpenClaw's fallback PDF path: extract text first, render selected
pages only when text is too short, and keep image work inside predictable page,
pixel, and dimension budgets.

## Install

```bash
npm install clawpdf
```

ESM-only. Node 22+ is supported.

## Quick Example

```ts
import { writeFile } from "node:fs/promises";
import { openPdf } from "clawpdf";

await using pdf = await openPdf("report.pdf");

console.log(pdf.pageCount);
console.log(pdf.text({ maxPages: 5 }));

const png = await pdf.page(1).png({ dpi: 144, forms: true });
await writeFile("page-1.png", png);
```

For server code, keep one `PdfEngine` alive and reuse it. The top-level
`extractPdf(...)` helper also shares a default engine when no `engine` option is
provided.

## CLI Example

```bash
clawpdf report.pdf
cat report.pdf | clawpdf -
clawpdf render report.pdf --page 1 > page.png
```

## Feature Map

- [Loading PDFs](loading.md) covers engines, inputs, lifetimes, and passwords.
- [CLI](cli.md) covers shell extraction, JSON output, rendering, and exit codes.
- [Text Extraction](text-extraction.md) covers page text and selected-page extraction.
- [Page Rendering](page-rendering.md) covers DPI, scale, target sizes, backgrounds, and form widgets.
- [PNG Output](png-output.md) covers page PNGs and standalone encoding.
- [Extraction Fallback](extraction-fallback.md) covers text-first extraction with image fallback.
- [Password-Protected PDFs](passwords.md) covers user-password handling.
- [Browser and Bundlers](browser-bundlers.md) covers `clawpdf/browser`.
- [PDFium Provenance](pdfium-provenance.md) covers the vendored binary and refresh workflow.
- [Package Shape](package-shape.md) covers dependencies and published files.
- [Performance](performance.md) records the current comparison snapshot.
- [API Reference](api-reference.md) lists the exported API surface.
