---
title: PDFium Provenance
description: Understand the vendored PDFium build and refresh workflow.
---

# PDFium Provenance

ClawPDF vendors `pdfium-lib` release `7623`.

Current vendored WASM SHA-256:

```txt
14ca2adbe23b45dea57da28ae2746e376f1cddfb8e2d0b01b71dcc5cf227734e
```

## Refresh Workflow

```bash
pnpm download:pdfium
pnpm test
```

`scripts/download-pdfium.mjs` downloads the pinned `wasm.tgz` asset, verifies
the archive hash and WASM hash, then updates `src/vendor`.

To move to a newer `pdfium-lib` release, update:

- `scripts/download-pdfium.mjs`
- `src/constants.ts`
- `README.md`
- this page

## License Notices

The wrapper is MIT licensed. PDFium has upstream BSD-style and Apache-2.0
notices. See `THIRD_PARTY_NOTICES.md`.
