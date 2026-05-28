import { describe, expect, it } from "vitest";
import { encodePngRgba, encodePngRgbaCompressed, extractPdfContent, loadClawPDF, PDFIUM_RELEASE } from "../src/index.js";

describe("clawpdf", () => {
  it("extracts text from a PDF", async () => {
    const pdf = makeTextPdf("Hello ClawPDF");
    const library = await loadClawPDF();
    try {
      const document = library.loadDocument(pdf);
      try {
        expect(PDFIUM_RELEASE).toBe("7623");
        expect(document.pageCount).toBe(1);
        expect(document.getPageText(0)).toContain("Hello ClawPDF");
      } finally {
        document.destroy();
      }
    } finally {
      library.destroy();
    }
  });

  it("renders pages to RGBA and PNG", async () => {
    const library = await loadClawPDF();
    try {
      const document = library.loadDocument(makeTextPdf("Render me"));
      try {
        const rendered = document.renderPage(0, { scale: 0.5 });
        expect(rendered.width).toBeGreaterThan(0);
        expect(rendered.height).toBeGreaterThan(0);
        expect(rendered.rgba.byteLength).toBe(rendered.width * rendered.height * 4);

        const png = document.renderPagePng(0, { scale: 0.5 });
        expect(Array.from(png.png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);

        const compressed = await document.renderPagePngCompressed(0, { scale: 0.5 });
        expect(Array.from(compressed.png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
        expect(compressed.png.byteLength).toBeLessThan(png.png.byteLength);
      } finally {
        document.destroy();
      }
    } finally {
      library.destroy();
    }
  });

  it("supports OpenClaw-style text-first extraction fallback", async () => {
    const pdf = makeTextPdf("Short");
    const textOnly = await extractPdfContent(pdf, { minTextChars: 1, maxPages: 1 });
    expect(textOnly.text).toContain("Short");
    expect(textOnly.images).toHaveLength(0);

    const withImage = await extractPdfContent(pdf, { minTextChars: 1000, maxPages: 1, maxPixels: 100_000 });
    expect(withImage.text).toContain("Short");
    expect(withImage.images).toHaveLength(1);
    expect(withImage.images[0]?.mimeType).toBe("image/png");
    expect(withImage.images[0]?.data.length).toBeLessThan(20_000);
  });

  it("rounds fractional rendered dimensions up", async () => {
    const library = await loadClawPDF();
    try {
      const document = library.loadDocument(makeTextPdf("Small", { width: 16.875, height: 12.75 }));
      try {
        const rendered = document.renderPage(0, { scale: 2 });
        expect(rendered.width).toBe(34);
        expect(rendered.height).toBe(26);
      } finally {
        document.destroy();
      }
    } finally {
      library.destroy();
    }
  });

  it("encodes standalone RGBA PNGs", async () => {
    const png = encodePngRgba(1, 1, Uint8Array.from([255, 0, 0, 255]));
    expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);

    const compressed = await encodePngRgbaCompressed(8, 8, new Uint8Array(8 * 8 * 4).fill(255));
    expect(Array.from(compressed.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(compressed.byteLength).toBeLessThan(encodePngRgba(8, 8, new Uint8Array(8 * 8 * 4).fill(255)).byteLength);
  });
});

function makeTextPdf(text: string, options: { width?: number; height?: number } = {}): Uint8Array {
  const escaped = text.replace(/[()\\]/g, (char) => `\\${char}`);
  const width = options.width ?? 612;
  const height = options.height ?? 792;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    stream(`BT /F1 24 Tf 72 720 Td (${escaped}) Tj ET`),
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(Buffer.byteLength(body, "utf8"));
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body, "utf8");
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  body += `startxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

function stream(content: string): string {
  return `<< /Length ${Buffer.byteLength(content, "utf8")} >>\nstream\n${content}\nendstream`;
}
