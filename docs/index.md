---
title: Overview
description: Zero-dependency PDFium WebAssembly bindings for text extraction and page rendering.
---

# ClawPDF

ClawPDF is a small PDFium WebAssembly wrapper for Node and browsers. It loads
PDF bytes, extracts text, renders pages, and produces PNG fallback images
without pulling in a native canvas package, postinstall scripts, or runtime
dependencies.

It is built for OpenClaw's fallback PDF path: extract text first, render selected
pages only when text is too short, and keep image work inside predictable page,
pixel, and dimension budgets.

## Install

```bash
npm install clawpdf
```

ESM-only. Node 20+ is supported.

## Quick Example

```ts
import { loadClawPDF } from "clawpdf";

const library = await loadClawPDF();

try {
  const document = library.loadDocument(pdfBytes);

  try {
    console.log(document.pageCount);
    console.log(document.extractText({ maxPages: 5 }));

    const page = await document.renderPagePngCompressed(0, {
      scale: 2,
      renderForms: true,
    });
    await fs.promises.writeFile("page-1.png", page.png);
  } finally {
    document.destroy();
  }
} finally {
  library.destroy();
}
```

## Feature Map

- [Loading PDFs](loading.md) covers library setup, WASM loading, lifetimes, and passwords.
- [Text Extraction](text-extraction.md) covers page text and selected-page extraction.
- [Page Rendering](page-rendering.md) covers RGBA rendering, scale, dimensions, transparency, and form widgets.
- [PNG Output](png-output.md) covers sync and compressed PNG encoding.
- [Extraction Fallback](extraction-fallback.md) covers text-first extraction with image fallback.
- [Password-Protected PDFs](passwords.md) covers user-password handling.
- [Browser and Bundlers](browser-bundlers.md) covers `wasmUrl`, `wasmBinary`, and custom instantiation.
- [PDFium Provenance](pdfium-provenance.md) covers the vendored binary and refresh workflow.
- [Package Shape](package-shape.md) covers dependencies and published files.
- [Performance](performance.md) records the current comparison snapshot.
- [API Reference](api-reference.md) lists the exported API surface.
