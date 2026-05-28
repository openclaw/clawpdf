---
title: Password-Protected PDFs
description: Open encrypted PDFs with a user password.
---

# Password-Protected PDFs

ClawPDF supports encrypted PDFs that PDFium can open with a user password.

## Document API

```ts
import { openPdf } from "clawpdf";

await using pdf = await openPdf("secret.pdf", { password: "secret" });
console.log(pdf.text());
```

Wrong or missing passwords throw `PdfPasswordError`.

## Extraction Helper

```ts
import { extractPdf } from "clawpdf";

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
