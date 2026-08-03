---
title: Browser and Bundlers
description: Load the packaged PDFium WebAssembly binary in browser and bundler environments.
---

# Browser and Bundlers

Use `clawpdf/browser` in bundled browser code. It exports the same API as
`clawpdf` but pre-wires the packaged WASM URL through `import.meta.url`.

```ts
import { openPdf } from "clawpdf/browser";

await using pdf = await openPdf(file);
console.log(pdf.text({ maxPages: 3 }));
```

Custom resolution stays available:

```ts
import { createEngine } from "clawpdf/browser";

await using engine = await createEngine({
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

Remote reads use the same 30-second default deadline as Node. Pass
`fetchTimeoutMs` or `signal` to `openPdf` and `extractPdf` to customize or
cancel a request without relying on `AbortSignal.timeout` support.

## Custom Instantiation

Pass `instantiateWasm` when a runtime needs a custom WebAssembly instantiation
path:

```ts
await using engine = await createEngine({
  instantiateWasm(imports, receiveInstance) {
    // Runtime-specific instantiation hook.
  },
});
```
