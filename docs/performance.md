---
title: Performance
description: Current local benchmark snapshot against pdf.js.
---

# Performance

Local Node benchmark on five sample PDFs, first page rendered at scale `2` with
text extraction and PNG encoding included.

## Snapshot

- Form: pdf.js `95.4 ms / 174.9 MB / 114,930 B`; ClawPDF `38.7 ms / 129.4 MB / 100,629 B`.
- Hello: pdf.js `65.2 ms / 159.7 MB / 41,408 B`; ClawPDF `27.2 ms / 124.1 MB / 47,106 B`.
- Scientific: pdf.js `176.9 ms / 202.0 MB / 608,807 B`; ClawPDF `66.0 ms / 137.8 MB / 321,122 B`.
- Magazine: pdf.js `519.4 ms / 312.0 MB / 1,616,318 B`; ClawPDF `255.9 ms / 179.5 MB / 1,930,947 B`.
- Checkmark: pdf.js `2.6 ms / 128.1 MB / 589 B`; ClawPDF `1.1 ms / 83.2 MB / 498 B`.

The largest win comes from avoiding the `pdfjs-dist` plus native canvas stack in
the fallback path. Magazine-style pages can still produce larger PNGs because
PNG compression choices differ between renderers.

## WASM Size Note

A local Emscripten relink with `-Oz` reduced the WASM by about 80 KB, roughly
2 percent, but was slower on render-heavy samples. The current vendored wrapper
keeps the upstream `-O2` build.
