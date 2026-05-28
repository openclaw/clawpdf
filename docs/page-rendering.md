---
title: Page Rendering
description: Render PDF pages to RGBA bitmaps with predictable size controls.
---

# Page Rendering

All page numbers are one-based.

```ts
const rendered = pdf.page(1).render({
  dpi: 144,
  forms: true,
});

console.log(rendered.width, rendered.height);
console.log(rendered.rgba.byteLength);
```

The RGBA byte length is always `width * height * 4`.

## Sizing

Render sizing accepts zero or one of:

- `dpi`: points are scaled from a 72 DPI baseline.
- `scale`: direct page scale.
- `width`: target pixel width; height follows page aspect ratio.
- `height`: target pixel height; width follows page aspect ratio.

Omitting all size fields defaults to `{ dpi: 96 }`. Passing more than one size
field throws `PdfError`.

## Options

- `background`: `"white"` or `"transparent"`, default `"white"`.
- `forms`: render AcroForm widgets, default `false`.
- `rotate`: additive rotation, one of `0`, `90`, `180`, `270`.

Rendered dimensions are rounded up with `Math.ceil`. Rendered pages are capped
before allocation. Budget failures throw `PdfBudgetError`.

## Page Properties

`PdfPage` exposes:

- `index`: one-based page number.
- `width` and `height`: PDF points.
- `rotation`: embedded page rotation.
