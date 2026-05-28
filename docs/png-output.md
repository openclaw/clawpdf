---
title: PNG Output
description: Encode rendered pages as dependency-free PNG images.
---

# PNG Output

ClawPDF includes PNG output so Node users do not need a native canvas package.

## Sync PNG

`renderPagePng(...)` returns PNG bytes synchronously.

```ts
const page = document.renderPagePng(0, { scale: 2 });
await fs.promises.writeFile("page.png", page.png);
```

The sync encoder uses stored zlib blocks. It is useful as a simple immediate
fallback, but the output is larger for full-page renders.

## Compressed PNG

`renderPagePngCompressed(...)` returns compressed PNG bytes asynchronously.

```ts
const page = await document.renderPagePngCompressed(0, {
  scale: 2,
  renderForms: true,
});
```

On Node, compressed PNG uses native `node:zlib`. In browsers, it uses
`CompressionStream` when available and falls back to stored zlib blocks
otherwise.

## Standalone Encoding

You can encode RGBA bytes directly:

```ts
import { encodePngRgba, encodePngRgbaCompressed } from "clawpdf";

const png = await encodePngRgbaCompressed(width, height, rgba);
```
