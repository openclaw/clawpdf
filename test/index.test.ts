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

  it("extracts selected pages within maxPages", async () => {
    const library = await loadClawPDF();
    try {
      const document = library.loadDocument(makeTextPdf(["First page", "Second page", "Third page"]));
      try {
        expect(document.extractText({ maxPages: 2 })).toContain("First page");
        expect(document.extractText({ maxPages: 2 })).toContain("Second page");
        expect(document.extractText({ maxPages: 2 })).not.toContain("Third page");

        const selected = document.extractText({ maxPages: 2, pageNumbers: [3, 99, 1] });
        expect(selected).toContain("Third page");
        expect(selected).toContain("First page");
        expect(selected).not.toContain("Second page");
      } finally {
        document.destroy();
      }
    } finally {
      library.destroy();
    }
  });

  it("does not apply the default page cap to explicit pageNumbers", async () => {
    const library = await loadClawPDF();
    const pages = Array.from({ length: 25 }, (_, index) => `Page ${index + 1}`);
    try {
      const document = library.loadDocument(makeTextPdf(pages));
      try {
        const selected = document.extractText({ pageNumbers: pages.map((_, index) => index + 1) });
        expect(selected).toContain("Page 1");
        expect(selected).toContain("Page 21");
        expect(selected).toContain("Page 25");

        const capped = document.extractText({ maxPages: 2, pageNumbers: [3, 2, 1] });
        expect(capped).toContain("Page 3");
        expect(capped).toContain("Page 2");
        expect(capped).not.toContain("Page 1");
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

  it("supports transparent page rendering", async () => {
    const library = await loadClawPDF();
    try {
      const document = library.loadDocument(makeTextPdf(""));
      try {
        const rendered = document.renderPage(0, { width: 4, height: 4, transparent: true });
        expect(rendered.rgba[3]).toBe(0);
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

  it("supports reusable library extraction and guards destroy with open documents", async () => {
    const pdf = makeTextPdf("Reusable");
    const library = await loadClawPDF();
    const document = library.loadDocument(pdf);
    try {
      expect(() => library.destroy()).toThrow("Cannot destroy ClawPDF library with 1 open document(s)");
    } finally {
      document.destroy();
    }

    const extracted = await library.extractPdfContent(pdf, { minTextChars: 1 });
    expect(extracted.text).toContain("Reusable");

    library.destroy();
    expect(() => library.loadDocument(pdf)).toThrow("ClawPDF library has been destroyed");
  });

  it("runs concurrent top-level extraction without per-call library teardown", async () => {
    const [first, second] = await Promise.all([
      extractPdfContent(makeTextPdf("Concurrent one"), { minTextChars: 1 }),
      extractPdfContent(makeTextPdf("Concurrent two"), { minTextChars: 1 }),
    ]);

    expect(first.text).toContain("Concurrent one");
    expect(second.text).toContain("Concurrent two");
  });

  it("keeps fallback render images inside maxPixels and maxDimension", async () => {
    const pdf = makeTextPdf("", { width: 1000, height: 200 });
    const byPixels = await extractPdfContent(pdf, { minTextChars: 1, maxPages: 1, maxPixels: 100 });
    expect(byPixels.images).toHaveLength(1);
    expect(pngDimensions(byPixels.images[0]!.data)).toEqual({ width: 20, height: 4 });

    const byDimension = await extractPdfContent(pdf, {
      minTextChars: 1,
      maxPages: 1,
      maxPixels: 1_000_000,
      maxDimension: 50,
    });
    expect(byDimension.images).toHaveLength(1);
    const dimensions = pngDimensions(byDimension.images[0]!.data);
    expect(dimensions.width).toBeLessThanOrEqual(50);
    expect(dimensions.height).toBeLessThanOrEqual(50);
    expect(dimensions).toEqual({ width: 50, height: 10 });
  });

  it("tracks image page numbers and consumes the pixel budget across pages", async () => {
    const pdf = makeTextPdf(["", "", ""], { width: 100, height: 100 });
    const result = await extractPdfContent(pdf, {
      minTextChars: 1,
      maxPages: 3,
      maxPixels: 200,
      maxDimension: 10,
      pageNumbers: [2, 3, 1],
    });
    expect(result.images.map((image) => image.pageNumber)).toEqual([2, 3]);
    expect(result.images.map((image) => pngDimensions(image.data))).toEqual([
      { width: 10, height: 10 },
      { width: 10, height: 10 },
    ]);
  });

  it("supports password-protected PDFs through document and helper APIs", async () => {
    const pdf = passwordProtectedPdf();
    const library = await loadClawPDF();
    try {
      expect(() => library.loadDocument(pdf)).toThrow("PDF password is required or incorrect");
      expect(() => library.loadDocument(pdf, "wrong")).toThrow("PDF password is required or incorrect");
      const document = library.loadDocument(pdf, "secret");
      try {
        expect(document.getPageText(0)).toContain("Secret ClawPDF");
      } finally {
        document.destroy();
      }
    } finally {
      library.destroy();
    }

    const extracted = await extractPdfContent(pdf, { password: "secret", minTextChars: 1 });
    expect(extracted.text).toContain("Secret ClawPDF");
    await expect(extractPdfContent(pdf, { password: "wrong" })).rejects.toThrow(
      "PDF password is required or incorrect",
    );
  });

  it("reports invalid PDFs and out-of-range page indexes", async () => {
    await expect(extractPdfContent(new TextEncoder().encode("not a pdf"))).rejects.toThrow(
      "Input is not a valid PDF or is corrupted",
    );

    const library = await loadClawPDF();
    try {
      const document = library.loadDocument(makeTextPdf("Page"));
      try {
        expect(() => document.getPageText(1)).toThrow("Page index 1 is outside 0..0");
      } finally {
        document.destroy();
      }
    } finally {
      library.destroy();
    }
  });

  it("rejects invalid render and extraction limits before allocation", async () => {
    const library = await loadClawPDF();
    try {
      const document = library.loadDocument(makeTextPdf("Limits"));
      try {
        expect(() => document.renderPage(0, { scale: Number.NaN })).toThrow("scale must be a finite positive number");
        expect(() => document.renderPage(0, { width: Number.POSITIVE_INFINITY })).toThrow(
          "width must be a finite positive number",
        );
        expect(() => document.renderPage(0, { height: -1 })).toThrow("height must be a finite positive number");
        expect(() => document.renderPage(0, { scale: 1_000 })).toThrow("Rendered page has");
        expect(() => document.extractContent({ maxPixels: Number.POSITIVE_INFINITY })).toThrow(
          "maxPixels must be a finite positive number",
        );
        expect(() => document.extractContent({ maxDimension: 0 })).toThrow(
          "maxDimension must be a finite positive number",
        );
        expect(() => document.extractContent({ renderScale: Number.NaN })).toThrow(
          "renderScale must be a finite positive number",
        );
      } finally {
        document.destroy();
      }
    } finally {
      library.destroy();
    }

    await expect(extractPdfContent(makeTextPdf("Limits"), { maxPixels: Number.POSITIVE_INFINITY })).rejects.toThrow(
      "maxPixels must be a finite positive number",
    );
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

    expect(() => encodePngRgba(0, 1, new Uint8Array())).toThrow("PNG dimensions must be positive integers");
    expect(() => encodePngRgba(1, 1, new Uint8Array(3))).toThrow("RGBA buffer has 3 bytes; expected 4");
  });
});

function makeTextPdf(text: string | string[], options: { width?: number; height?: number } = {}): Uint8Array {
  const pages = Array.isArray(text) ? text : [text];
  const width = options.width ?? 612;
  const height = options.height ?? 792;
  const pageObjects: number[] = [];
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let nextObject = 4;
  for (const pageText of pages) {
    const escaped = pageText.replace(/[()\\]/g, (char) => `\\${char}`);
    const pageObject = nextObject;
    const contentObject = nextObject + 1;
    nextObject += 2;
    pageObjects.push(pageObject);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObject} 0 R >>`,
      stream(pageText ? `BT /F1 24 Tf 72 ${Math.max(1, height - 72)} Td (${escaped}) Tj ET` : ""),
    );
  }
  objects.splice(1, 0, `<< /Type /Pages /Kids [${pageObjects.map((object) => `${object} 0 R`).join(" ")}] /Count ${pages.length} >>`);
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

function pngDimensions(base64: string): { width: number; height: number } {
  const png = Buffer.from(base64, "base64");
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
}

function passwordProtectedPdf(): Uint8Array {
  return Buffer.from(
    [
      "JVBERi0xLjYKJb/3ov4KMSAwIG9iago8PCAvUGFnZXMgMiAwIFIgL1R5cGUgL0NhdGFsb2cgPj4KZW5kb2JqCjIgMCBvYmoKPDwg",
      "L0NvdW50IDEgL0tpZHMgWyAzIDAgUiBdIC9UeXBlIC9QYWdlcyA+PgplbmRvYmoKMyAwIG9iago8PCAvQ29udGVudHMgNCAwIFIg",
      "L01lZGlhQm94IFsgMCAwIDYxMiA3OTIgXSAvUGFyZW50IDIgMCBSIC9SZXNvdXJjZXMgPDwgL0ZvbnQgPDwgL0YxIDUgMCBSID4+",
      "ID4+IC9UeXBlIC9QYWdlID4+CmVuZG9iago0IDAgb2JqCjw8IC9MZW5ndGggODAgL0ZpbHRlciAvRmxhdGVEZWNvZGUgPj4Kc3Ry",
      "ZWFtCpLU7hcttTGHpV7gzFP386qPY6/p7f+uXflkSdyJs3lR7F5OYPO+YiV7IiZ19QY1ltYpn2Yd5iiWq/ZE8Tu8gtbLyrRf50TK",
      "VJzj6GfDW5aMCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iago8PCAvQmFzZUZvbnQgL0hlbHZldGljYSAvU3VidHlwZSAvVHlwZTEg",
      "L1R5cGUgL0ZvbnQgPj4KZW5kb2JqCjYgMCBvYmoKPDwgL0NGIDw8IC9TdGRDRiA8PCAvQXV0aEV2ZW50IC9Eb2NPcGVuIC9DRk0g",
      "L0FFU1YyIC9MZW5ndGggMTYgPj4gPj4gL0ZpbHRlciAvU3RhbmRhcmQgL0xlbmd0aCAxMjggL08gPDZlZjM3NjRhZDI2Y2ZlM2Nh",
      "YjY4NzA2ZmMyNmM5NDEzZDgwZDQ3YjA1MzM3NDUyOWEzMmUxNDA1ZWViYTQyYzE+IC9PRSA8PiAvUCAtMTAyOCAvUiA0IC9TdG1G",
      "IC9TdGRDRiAvU3RyRiAvU3RkQ0YgL1UgPGM0OWM5YmU2ODMyNDRhNTk5YTg2ZjE2NmFiNTk5NDkyMDAyMTQ0Njk5MGI5ZTQxMTQw",
      "NzFhNGQ5MTA0OTg0YzE+IC9VRSA8PiAvViA0ID4+CmVuZG9iagp4cmVmCjAgNwowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAw",
      "MTUgMDAwMDAgbiAKMDAwMDAwMDA2NCAwMDAwMCBuIAowMDAwMDAwMTIzIDAwMDAwIG4gCjAwMDAwMDAyNTEgMDAwMDAgbiAKMDAw",
      "MDAwMDQwMiAwMDAwMCBuIAowMDAwMDAwNDcyIDAwMDAwIG4gCnRyYWlsZXIgPDwgL1Jvb3QgMSAwIFIgL1NpemUgNyAvSUQgWzw1",
      "M2I5YmY2YmY0MzZmOTJiMjdiYWI0NTU0ZGJiMjkxMj48NTNiOWJmNmJmNDM2ZjkyYjI3YmFiNDU1NGRiYjI5MTI+XSAvRW5jcnlw",
      "dCA2IDAgUiA+PgpzdGFydHhyZWYKNzg4CiUlRU9GCg==",
    ].join(""),
    "base64",
  );
}
