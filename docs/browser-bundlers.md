---
title: Browser and Bundlers
description: Load the packaged PDFium WebAssembly binary in browser and bundler environments.
---

# Browser and Bundlers

Node can load the packaged WASM file automatically. Browser and bundler setups
usually need to pass a URL or bytes explicitly.

## URL Loading

```ts
const library = await loadClawPDF({
  wasmUrl: new URL("pdfium.esm.wasm", import.meta.url).href,
});
```

The URL is passed to the Emscripten `locateFile` hook.

## Byte Loading

```ts
const wasmBinary = await fetch("/assets/pdfium.esm.wasm").then((res) =>
  res.arrayBuffer(),
);

const library = await loadClawPDF({ wasmBinary });
```

Use `wasmBinary` when your bundler or host wants to own the fetch/cache policy.

## Custom Instantiation

Pass `instantiateWasm` when a runtime needs a custom WebAssembly instantiation
path:

```ts
const library = await loadClawPDF({
  instantiateWasm(imports, receiveInstance) {
    // Runtime-specific instantiation hook.
  },
});
```
