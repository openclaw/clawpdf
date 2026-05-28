export type PdfErrorCode =
  | "password"
  | "format"
  | "security"
  | "page_range"
  | "budget"
  | "destroyed"
  | "size_conflict";

export class PdfError extends Error {
  readonly code: PdfErrorCode;
  override readonly cause?: unknown;

  constructor(code: PdfErrorCode, message: string, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
    if ("cause" in options) {
      this.cause = options.cause;
    }
  }
}

export class PdfPasswordError extends PdfError {
  constructor(message = "PDF password is required or incorrect", options: { cause?: unknown } = {}) {
    super("password", message, options);
  }
}

export class PdfFormatError extends PdfError {
  constructor(message = "Input is not a valid PDF or is corrupted", options: { cause?: unknown } = {}) {
    super("format", message, options);
  }
}

export class PdfSecurityError extends PdfError {
  constructor(message = "PDF security handler is unsupported", options: { cause?: unknown } = {}) {
    super("security", message, options);
  }
}

export class PdfPageRangeError extends PdfError {
  readonly pageCount: number;
  readonly requested: number;

  constructor(requested: number, pageCount: number) {
    super("page_range", `Page ${requested} is outside 1..${pageCount}`);
    this.requested = requested;
    this.pageCount = pageCount;
  }
}

export class PdfBudgetError extends PdfError {
  readonly limit: "maxPixels" | "maxDimension" | "maxTextChars" | "renderPixels";
  readonly value: number;

  constructor(
    limit: "maxPixels" | "maxDimension" | "maxTextChars" | "renderPixels",
    value: number,
    message = `${limit} budget exceeded: ${value}`,
  ) {
    super("budget", message);
    this.limit = limit;
    this.value = value;
  }
}

export class PdfDestroyedError extends PdfError {
  constructor(message = "PDF resource has been destroyed") {
    super("destroyed", message);
  }
}
