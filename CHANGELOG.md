# Changelog

## Unreleased

- Added password support to the top-level extraction helper.
- Added a maximum rendered image dimension cap for extraction fallback.
- Added broader PDF extraction, rendering, password, error, PNG, and CI coverage.

## 0.1.0

- Added zero-runtime-dependency PDFium WebAssembly bindings for Node and browsers.
- Added packaged `pdfium-lib` release `7623` loader with SHA-256 provenance.
- Added PDF loading from `Uint8Array` and `ArrayBuffer`, including password support.
- Added page count, per-page text extraction, and multi-page text extraction.
- Added RGBA page rendering with scale, size override, transparent background, and form rendering options.
- Added sync PNG encoding for rendered pages with no native canvas dependency.
- Added compressed PNG rendering and text-first extraction fallback for multimodal model input.
- Added top-level `extractPdfContent(...)` helper for OpenClaw-style text-first PDF handling.
- Added deterministic package shape with no runtime dependencies, native addons, postinstall scripts, or canvas dependency.
- Added PDFium refresh script with archive and WASM hash verification.
- Added CI, TypeScript declarations, tests, README usage docs, third-party notices, and benchmark snapshot.
