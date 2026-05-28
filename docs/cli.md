---
title: CLI
description: Extract PDF text and render PNG pages from shell scripts.
---

# CLI

The npm package includes a `clawpdf` command for shell and agent workflows.

```bash
npm install clawpdf
```

## Extract Text

```bash
clawpdf report.pdf
cat report.pdf | clawpdf -
```

The default command is shorthand for `clawpdf extract` and prints extracted text
to stdout. Diagnostics and errors go to stderr.

## JSON Output

```bash
clawpdf report.pdf --json
clawpdf extract report.pdf --mode both --pages 1,3-5 --json
```

JSON output uses a stable shape:

```json
{
  "text": "...",
  "pagesProcessed": [1],
  "truncated": { "text": false, "images": false },
  "images": [
    {
      "page": 1,
      "width": 800,
      "height": 1000,
      "mimeType": "image/png",
      "base64": "..."
    }
  ]
}
```

## Render One Page

```bash
clawpdf render report.pdf --page 1 > page.png
clawpdf render report.pdf --page 1 -o page.png
clawpdf render report.pdf --page 1 --inline auto
```

Rendering writes PNG bytes to stdout unless `-o, --output` is provided.
Use `--inline auto|kitty|iterm|none` to render the page in supported terminals
instead of writing binary PNG bytes to stdout.

## Common Flags

- `--mode auto|text|images|both` selects extraction behavior.
- `--pages 1,3-5` selects one-based pages for extraction.
- `--max-pages`, `--max-text-chars`, and `--min-text-chars` set extraction limits. The CLI caps extraction at 20 pages unless `--max-pages` is set, and rejects page lists above 100,000 pages.
- `--dpi` or `--scale` controls image size.
- `--max-pixels` and `--max-dimension` bound fallback image output.
- `--forms` and `--no-forms` control form rendering.
- `--password <value>` or `--password-file <path>` opens encrypted PDFs.
- `--output-dir <dir>` writes extracted fallback images as `page-N.png`.
- `--inline auto|kitty|iterm|none` renders extracted or rendered PNGs inline in supported terminals. It is not supported with `--json`.

## Exit Codes

- `0`: success.
- `1`: runtime extraction or rendering failure.
- `2`: invalid usage or flags.
- `3`: input could not be read or parsed as a PDF.
- `4`: password is missing or incorrect.
- `5`: render or extraction budget exceeded.
