---
title: Loading PDFs
description: Create a ClawPDF engine and load PDF documents.
---

# Loading PDFs

Use `openPdf(...)` for scripts and one-off work:

```ts
import { openPdf } from "clawpdf";

await using pdf = await openPdf("report.pdf");
console.log(pdf.pageCount);
```

Use `createEngine(...)` for servers:

```ts
import { createEngine } from "clawpdf";

await using engine = await createEngine();
const pdf = await engine.open(pdfBytes);
try {
  console.log(pdf.text());
} finally {
  pdf.destroy();
}
```

## Inputs

Accepted inputs:

- `Uint8Array` and `ArrayBuffer`: used directly.
- Node file path string: read from disk.
- URL string or `URL`: fetched.
- `Blob`: read with `arrayBuffer()`.

In browsers, string inputs must be URLs. Path-like strings throw
`PdfFormatError`.

## Lifetime

`openPdf(...)` creates a private engine for the document. Destroying the
document also destroys that private engine.

`createEngine(...)` returns a long-lived engine you own. `engine.destroy()`
closes still-open documents before destroying PDFium. Calling `destroy()` twice
is safe. Calling other methods after destroy throws `PdfDestroyedError`.

## Passwords

Pass a user password when opening:

```ts
const pdf = await openPdf("secret.pdf", { password: "secret" });
```

Wrong or missing passwords throw `PdfPasswordError`.

## Load Options

`createEngine(options)` accepts:

- `wasmUrl`: URL/path passed to the Emscripten loader.
- `wasmBinary`: raw WASM bytes.
- `instantiateWasm`: custom Emscripten instantiate hook.
- `maxRenderPixels`: per-render pixel hard cap.

Node loads the packaged `dist/vendor/pdfium.esm.wasm` automatically.
