---
title: Text Extraction
description: Extract selectable PDF text from one page or selected pages.
---

# Text Extraction

Use `getPageText(pageIndex)` for one zero-based page.

```ts
const text = document.getPageText(0);
```

Use `extractText(...)` for a multi-page text pass.

```ts
const text = document.extractText({
  maxPages: 5,
  pageNumbers: [1, 3, 4],
});
```

`pageNumbers` are one-based because they are user-facing PDF page numbers.
Direct document APIs such as `getPageText(0)` and `renderPage(0)` use zero-based
indexes.

## Limits

`extractText` stops after `maxPages` effective pages. When `pageNumbers` is
provided without `maxPages`, the explicit page list is used as-is instead of
being capped by the default `20` pages. Text output is capped at 200,000
characters so huge PDFs cannot accidentally become enormous prompt payloads.

Invalid `pageNumbers` are ignored. For example, page `99` is skipped when the
document has only three pages.

## Text Shape

PDF text extraction preserves PDFium's text order. It is good for search,
summaries, and model context, but PDFs do not always encode text in visual
reading order.
