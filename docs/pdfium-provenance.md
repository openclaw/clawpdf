---
title: PDFium Provenance
description: Understand the vendored PDFium build and refresh workflow.
---

# PDFium Provenance

ClawPDF vendors `pdfium-lib` release `7902`.

Current vendored WASM SHA-256:

```txt
f3fe52ae7f150e912a8379ec4478cac9c11b4135dc56fdc039b0ff885f1c0981
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
