---
title: Extraction Fallback
description: Use text-first PDF extraction with bounded PNG fallback images.
---

# Extraction Fallback

`extractPdf(...)` is the high-level helper intended for OpenClaw-style model
input.

```ts
import { extractPdf } from "clawpdf";

const result = await extractPdf("report.pdf", {
  mode: "auto",
  maxPages: 20,
  minTextChars: 200,
  image: {
    dpi: 96,
    maxPixels: 4_000_000,
    maxDimension: 10_000,
    forms: true,
  },
});
```

Flow for `mode: "auto"`:

1. Extract text from selected pages.
2. Return text only when text length reaches `minTextChars`.
3. Otherwise render selected pages as compressed PNG images.
4. Stop rendering when image budget is exhausted.

## Modes

- `auto`: always extract text; render images only when text is short.
- `text`: extract text only.
- `images`: render images only.
- `both`: extract text and render images.

## Options

- `pages`: one-based pages to inspect.
- `maxPages`: finite positive maximum pages to inspect; the default `20` is ignored when `pages` is provided, but an explicit `maxPages` still caps that list.
- `minTextChars`: text threshold before image fallback, default `200`.
- `maxTextChars`: text output cap, default `200_000`.
- `password`: optional PDF user password.
- `engine`: optional `PdfEngine` for caller-owned reuse.
- `image.dpi` or `image.scale`: fallback render size, default `dpi: 96`.
- `image.maxPixels`: finite positive total rendered image pixel budget, default `4_000_000`.
- `image.maxDimension`: finite positive maximum rendered PNG width or height, default `10_000`.
- `image.forms`: render form widgets in fallback images, default `true`.

## Result

```ts
type ExtractResult = {
  text: string;
  images: Array<{
    page: number;
    width: number;
    height: number;
    bytes: Uint8Array;
    mimeType: "image/png";
  }>;
  pagesProcessed: number[];
  truncated: {
    text: boolean;
    images: boolean;
  };
};
```

Image bytes are raw PNG data. Use `toMessageContent(result)` or
`toDataUrls(result)` when a transport needs base64.
