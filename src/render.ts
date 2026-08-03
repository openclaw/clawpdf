import { PdfBudgetError, PdfError } from "./errors.js";

export type RenderOptions = (
  | { dpi?: number; scale?: never; width?: never; height?: never }
  | { dpi?: never; scale?: number; width?: never; height?: never }
  | { dpi?: never; scale?: never; width?: number; height?: never }
  | { dpi?: never; scale?: never; width?: never; height?: number }
) & {
  background?: "white" | "transparent";
  forms?: boolean;
  rotate?: 0 | 90 | 180 | 270;
};

export type ResolvedRenderSize = {
  width: number;
  height: number;
  scale: number;
  rotate: 0 | 1 | 2 | 3;
};

export function resolveRenderSize(
  pageWidth: number,
  pageHeight: number,
  embeddedRotation: 0 | 90 | 180 | 270,
  options: RenderOptions = {},
  maxRenderPixels: number,
): ResolvedRenderSize {
  const sizeKeys = (["dpi", "scale", "width", "height"] as const).filter((key) => options[key] !== undefined);
  if (sizeKeys.length > 1) {
    throw new PdfError("size_conflict", `render() expects at most one of dpi, scale, width, height; got ${sizeKeys.join(", ")}`);
  }

  const additiveRotation = options.rotate ?? 0;
  const totalRotation = ((embeddedRotation + additiveRotation) % 360) as 0 | 90 | 180 | 270;
  const rotate = (totalRotation / 90) as 0 | 1 | 2 | 3;
  const rotated = rotate % 2 === 1;
  const baseWidth = rotated ? pageHeight : pageWidth;
  const baseHeight = rotated ? pageWidth : pageHeight;
  let scale: number;
  let width: number;
  let height: number;

  if (options.width !== undefined) {
    width = positiveInteger("width", options.width);
    scale = width / positiveFiniteNumber("page width", baseWidth);
    height = Math.max(1, Math.ceil(baseHeight * scale));
  } else if (options.height !== undefined) {
    height = positiveInteger("height", options.height);
    scale = height / positiveFiniteNumber("page height", baseHeight);
    width = Math.max(1, Math.ceil(baseWidth * scale));
  } else {
    scale = options.scale !== undefined
      ? positiveFiniteNumber("scale", options.scale)
      : positiveFiniteNumber("dpi", options.dpi ?? 96) / 72;
    width = Math.max(1, Math.ceil(baseWidth * scale));
    height = Math.max(1, Math.ceil(baseHeight * scale));
  }

  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels > maxRenderPixels) {
    throw new PdfBudgetError("renderPixels", pixels, `Rendered page has ${pixels} pixels; limit is ${maxRenderPixels}`);
  }

  return { width, height, scale, rotate };
}

export function planImageRender(
  pageWidth: number,
  pageHeight: number,
  requestedScale: number,
  remainingPixels: number,
  maxDimension: number,
): { scale: number; width: number; height: number; capped: boolean } | null {
  if (pageWidth <= 0 || pageHeight <= 0 || remainingPixels <= 0) {
    return null;
  }
  const dimensionLimit = positiveInteger("maxDimension", maxDimension);
  const pixelLimit = positiveInteger("maxPixels", remainingPixels);
  const maxScale = Math.min(
    requestedScale,
    Math.sqrt(pixelLimit / Math.max(1, pageWidth * pageHeight)),
    dimensionLimit / pageWidth,
    dimensionLimit / pageHeight,
  );
  if (!Number.isFinite(maxScale) || maxScale <= 0) {
    return null;
  }
  const capped = maxScale < requestedScale - 1e-9;

  let best: { scale: number; width: number; height: number } | null = null;
  let low = 0;
  let high = maxScale;
  for (let i = 0; i < 32; i += 1) {
    const scale = (low + high) / 2;
    const width = Math.max(1, Math.ceil(pageWidth * scale));
    const height = Math.max(1, Math.ceil(pageHeight * scale));
    if (width <= dimensionLimit && height <= dimensionLimit && width * height <= pixelLimit) {
      best = { scale, width, height };
      low = scale;
    } else {
      high = scale;
    }
  }
  return best ? { ...best, capped } : null;
}

export function positiveInteger(name: string, value: number): number {
  return Math.max(1, Math.floor(positiveFiniteNumber(name, value)));
}

export function nonNegativeInteger(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new PdfError("budget", `${name} must be a finite non-negative number`);
  }
  return Math.floor(value);
}

export function positiveFiniteNumber(name: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new PdfError("budget", `${name} must be a finite positive number`);
  }
  return value;
}
