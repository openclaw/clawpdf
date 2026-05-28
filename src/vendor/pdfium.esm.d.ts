export type PdfiumModule = {
  _FPDF_InitLibraryWithConfig(config: object): void;
  _FPDF_DestroyLibrary(): void;
  _FPDF_LoadMemDocument(documentPtr: number, documentSize: number, passwordPtr: number): number;
  _FPDF_CloseDocument(document: number): void;
  _FPDF_GetLastError(): number;
  _FPDF_GetPageCount(document: number): number;
  _FPDF_LoadPage(document: number, pageIndex: number): number;
  _FPDF_ClosePage(page: number): void;
  _FPDF_GetPageWidth(page: number): number;
  _FPDF_GetPageHeight(page: number): number;
  _FPDFText_LoadPage(page: number): number;
  _FPDFText_ClosePage(textPage: number): void;
  _FPDFText_CountChars(textPage: number): number;
  _FPDFText_GetText(textPage: number, startIndex: number, count: number, buffer: number): number;
  _FPDFBitmap_CreateEx(
    width: number,
    height: number,
    format: number,
    buffer: number,
    stride: number,
  ): number;
  _FPDFBitmap_FillRect(
    bitmap: number,
    left: number,
    top: number,
    width: number,
    height: number,
    color: number,
  ): void;
  _FPDF_RenderPageBitmap(
    bitmap: number,
    page: number,
    startX: number,
    startY: number,
    width: number,
    height: number,
    rotate: number,
    flags: number,
  ): void;
  _FPDFBitmap_Destroy(bitmap: number): void;
  _FPDFDOC_InitFormFillEnvironment(document: number, formHandle: number): number;
  _FPDFDOC_ExitFormFillEnvironment(formHandle: number): void;
  _FORM_OnAfterLoadPage(page: number, formHandle: number): void;
  _FORM_OnBeforeClosePage(page: number, formHandle: number): void;
  _FPDF_FFLDraw(
    formHandle: number,
    bitmap: number,
    page: number,
    startX: number,
    startY: number,
    width: number,
    height: number,
    rotate: number,
    flags: number,
  ): void;
  wasmExports: {
    malloc(size: number): number;
    free(ptr: number): void;
  };
  HEAPU8: Uint8Array;
};

export type LoadPdfiumOptions = {
  wasmBinary?: ArrayBuffer;
  locateFile?: (path: string) => string;
  instantiateWasm?: (
    imports: WebAssembly.Imports,
    successCallback: (module: WebAssembly.Module) => void,
  ) => WebAssembly.Exports;
};

export default function loadPdfium(options?: LoadPdfiumOptions): Promise<PdfiumModule>;
