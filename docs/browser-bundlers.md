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

HTTP(S) reads use the same 30-second default deadline and unlimited download
size as Node. Pass a positive `fetchMaxBytes` to `openPdf` or `extractPdf` to opt
into a body budget; `0` leaves it unlimited. Use `fetchTimeoutMs` or `signal` to
customize or cancel a request without relying on `AbortSignal.timeout` support.

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
