---
title: Extraction Fallback
description: Use text-first PDF extraction with bounded PNG fallback images.
---

# Extraction Fallback

`extractPdfContent(...)` is the high-level helper intended for OpenClaw-style
model input.

```ts
import { extractPdfContent } from "clawpdf";

const result = await extractPdfContent(pdfBytes, {
  maxPages: 20,
  maxDimension: 10_000,
  maxPixels: 4_000_000,
  minTextChars: 200,
});
```

Flow:

1. Extract text from selected pages.
2. Return text only when the text length reaches `minTextChars`.
3. Otherwise render selected pages as compressed PNG images.
4. Stop rendering when the total image budget is exhausted.

## Options

- `maxPages`: maximum pages to inspect, default `20`.
- `maxDimension`: maximum rendered PNG width or height, default `10,000`.
- `maxPixels`: total rendered image pixel budget, default `4,000,000`.
- `minTextChars`: text threshold before image fallback, default `200`.
- `pageNumbers`: one-based pages to inspect.
- `password`: optional PDF user password.
- `renderScale`: preferred fallback render scale, default `1`.

## Result

```ts
type PdfExtractResult = {
  text: string;
  images: Array<{
    type: "image";
    mimeType: "image/png";
    data: string;
    pageNumber: number;
  }>;
};
```

`data` is base64 PNG data. `pageNumber` is one-based.

## Budget Behavior

The fallback renderer chooses a scale that keeps each image inside
`maxDimension` and keeps cumulative rendered pixels inside `maxPixels`.

When text is enough, no pages are rendered.
