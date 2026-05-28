---
title: Password-Protected PDFs
description: Open encrypted PDFs with a user password.
---

# Password-Protected PDFs

ClawPDF supports encrypted PDFs that PDFium can open with a user password.

## Document API

```ts
const document = library.loadDocument(pdfBytes, "secret");
```

Wrong or missing passwords throw:

```txt
PDF password is required or incorrect
```

## Extraction Helper

```ts
const result = await extractPdfContent(pdfBytes, {
  password: "secret",
  minTextChars: 200,
});
```

The password is used only for opening the document. It is not retained after the
document is loaded.

## Unsupported Security Handlers

PDFium reports unsupported encryption or security handlers as:

```txt
PDF security handler is unsupported
```
