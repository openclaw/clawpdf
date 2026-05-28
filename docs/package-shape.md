---
title: Package Shape
description: Runtime dependency and npm package layout.
---

# Package Shape

ClawPDF is intentionally boring to install.

Runtime dependencies:

- none
- no native addons
- no postinstall scripts
- no canvas dependency

Published files:

- `dist/index.js`
- `dist/index.d.ts`
- `dist/vendor/pdfium.esm.js`
- `dist/vendor/pdfium.esm.wasm`
- `CHANGELOG.md`
- `LICENSE`
- `README.md`
- `THIRD_PARTY_NOTICES.md`

The docs site is built into `site/` for GitHub Pages and is not included in the
npm package.
