---
title: Browser and Bundlers
description: Load the packaged PDFium WebAssembly binary in browser and bundler environments.
---

# Browser and Bundlers

Use `clawpdf/browser` in bundled browser code. It exports the same API as
`clawpdf` but pre-wires the packaged WASM URL through `import.meta.url`.

```ts
import { openPdf } from "clawpdf/browser";

const pdf = await openPdf(file);
```

Custom resolution stays available:

```ts
import { createEngine } from "clawpdf/browser";

const engine = await createEngine({
  wasmUrl: "/assets/pdfium.esm.wasm",
});
```

## Inputs

Browser inputs:

- `Uint8Array`
- `ArrayBuffer`
- URL string
- `URL`
- `Blob`

Path-like strings throw `PdfFormatError` in browsers because there is no file
system path to read.

## Custom Instantiation

Pass `instantiateWasm` when a runtime needs a custom WebAssembly instantiation
path:

```ts
const engine = await createEngine({
  instantiateWasm(imports, receiveInstance) {
    // Runtime-specific instantiation hook.
  },
});
```
