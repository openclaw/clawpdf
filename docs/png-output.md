---
title: PNG Output
description: Encode rendered pages as dependency-free PNG images.
---

# PNG Output

ClawPDF includes PNG output so Node users do not need a native canvas package.

## Page PNG

`page.png(...)` returns compressed PNG bytes asynchronously:

```ts
import { writeFile } from "node:fs/promises";

const png = await pdf.page(1).png({ dpi: 144, forms: true });
await writeFile("page.png", png);
```

`page.pngSync(...)` returns PNG bytes synchronously using stored zlib blocks.
The output is larger, but it is useful when a strictly sync path matters.

```ts
const png = pdf.page(1).pngSync({ scale: 2 });
```

## Standalone Encoding

You can encode RGBA bytes directly:

```ts
import { encodePng } from "clawpdf";

const compressed = await encodePng(rgba, { width, height });
const stored = encodePng(rgba, { width, height, compress: false });
```

On Node, compressed PNG uses native `node:zlib`. In browsers, it uses
`CompressionStream` when available and falls back to stored zlib blocks.
