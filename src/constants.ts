export const PDFIUM_RELEASE = "7902";
export const PDFIUM_WASM_SHA256 = "f3fe52ae7f150e912a8379ec4478cac9c11b4135dc56fdc039b0ff885f1c0981";

export const PdfErrorCode = {
  Success: 0,
  Unknown: 1,
  File: 2,
  Format: 3,
  Password: 4,
  Security: 5,
  Page: 6,
} as const;

export const BitmapFormat = {
  Gray: 1,
  Bgr: 2,
  Bgrx: 3,
  Bgra: 4,
} as const;

export const RenderFlag = {
  Annot: 0x01,
  LcdText: 0x02,
  Grayscale: 0x08,
  ReverseByteOrder: 0x10,
} as const;
