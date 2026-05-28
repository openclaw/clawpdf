---
title: Page Rendering
description: Render PDF pages to RGBA bitmaps with predictable size controls.
---

# Page Rendering

`renderPage(pageIndex, options)` returns RGBA bytes for one zero-based page.

```ts
const rendered = document.renderPage(0, {
  scale: 2,
  renderForms: true,
});

console.log(rendered.width, rendered.height);
console.log(rendered.rgba.byteLength);
```

The RGBA byte length is always `width * height * 4`.

## Options

- `scale`: multiplier, default `1`.
- `width` and `height`: point-size override before scaling.
- `renderForms`: render AcroForm widgets.
- `transparent`: use a transparent page background instead of white.

Rendered dimensions are rounded up with `Math.ceil`, matching common PDF
renderer behavior for fractional page sizes.

## Original Dimensions

The returned object includes:

- `width` and `height`: rendered pixel dimensions.
- `originalWidth` and `originalHeight`: page dimensions reported by PDFium.
- `rgba`: rendered bitmap bytes.
