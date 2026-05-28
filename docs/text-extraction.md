---
title: Text Extraction
description: Extract selectable PDF text from one page or selected pages.
---

# Text Extraction

All page numbers are one-based.

```ts
const firstPageText = pdf.page(1).text();
```

Use `document.text(...)` for multi-page extraction:

```ts
const text = pdf.text({
  maxPages: 5,
  pages: [1, 3, 4],
  maxChars: 200_000,
});
```

When `pages` is provided without `maxPages`, the explicit page list is used as
is. Invalid page numbers throw `PdfPageRangeError`.

## Limits

`text(...)` stops after `maxPages` effective pages. Text output is capped by
`maxChars`, default `200_000`, so huge PDFs cannot accidentally become enormous
prompt payloads.

## Text Shape

PDF text extraction preserves PDFium's text order. It is good for search,
summaries, and model context, but PDFs do not always encode text in visual
reading order.
