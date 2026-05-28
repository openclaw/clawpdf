---
title: Loading PDFs
description: Create a ClawPDF library handle and load PDF documents from bytes.
---

# Loading PDFs

Load PDFium once, then load one or more PDF documents from `Uint8Array` or
`ArrayBuffer` input.

```ts
import { loadClawPDF } from "clawpdf";

const library = await loadClawPDF();

try {
  const document = library.loadDocument(pdfBytes);
  try {
    console.log(document.pageCount);
  } finally {
    document.destroy();
  }
} finally {
  library.destroy();
}
```

## Library Lifetime

`loadClawPDF()` initializes PDFium and returns a `ClawPDF` handle. Call
`library.destroy()` when the handle is no longer needed.

Each `library.loadDocument(...)` call returns a `PdfDocument`. Call
`document.destroy()` after extraction or rendering so PDFium can release document
memory.

`library.destroy()` throws while documents opened by that library are still
alive. Server code should keep one `ClawPDF` library around and reuse it across
requests instead of loading and destroying PDFium per file.

For one-shot extraction, `extractPdfContent(...)` uses a shared package-level
library unless you pass your own `library` option.

## Passwords

Pass a user password as the second `loadDocument` argument:

```ts
const document = library.loadDocument(pdfBytes, "secret");
```

If a PDF requires a password, loading without the right password throws:

```txt
PDF password is required or incorrect
```

## Load Options

`loadClawPDF(options)` accepts:

- `wasmUrl`: URL or path passed to the Emscripten loader.
- `wasmBinary`: raw WASM bytes.
- `instantiateWasm`: custom Emscripten instantiate hook.

Node loads the packaged `dist/vendor/pdfium.esm.wasm` automatically.
