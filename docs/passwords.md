---
title: Password-Protected PDFs
description: Open encrypted PDFs with a user password.
---

# Password-Protected PDFs

ClawPDF supports encrypted PDFs that PDFium can open with a user password.

## Document API

```ts
const pdf = await openPdf("secret.pdf", { password: "secret" });
```

Wrong or missing passwords throw `PdfPasswordError`.

## Extraction Helper

```ts
const result = await extractPdf("secret.pdf", {
  password: "secret",
  minTextChars: 200,
});
```

The password is used only for opening the document. It is not retained after the
document is loaded.

## Unsupported Security Handlers

PDFium reports unsupported encryption or security handlers as
`PdfSecurityError`.
