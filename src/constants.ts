export const PDFIUM_RELEASE = "7623";
export const PDFIUM_WASM_SHA256 = "14ca2adbe23b45dea57da28ae2746e376f1cddfb8e2d0b01b71dcc5cf227734e";

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
