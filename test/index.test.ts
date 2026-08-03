import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  PDFIUM_RELEASE,
  PdfBudgetError,
  PdfDestroyedError,
  PdfError,
  PdfFormatError,
  PdfPageRangeError,
  PdfPasswordError,
  createEngine,
  encodePng,
  extractPdf,
  openPdf,
  releaseExtractEngine,
  renderInlineImages,
  resolveInlineImageProtocol,
} from "../src/index.js";
import { toDataUrls, toMessageContent } from "../src/adapters/index.js";
import { withFormPageLifecycle } from "../src/document.js";

describe("clawpdf 0.2 API", () => {
  it("opens a PDF and exposes one-based page APIs", async () => {
    const engine = await createEngine();
    try {
      const pdf = await engine.open(makeTextPdf("Hello ClawPDF"));
      try {
        expect(PDFIUM_RELEASE).toBe("7902");
        expect(pdf.pageCount).toBe(1);
        expect(pdf.page(1).index).toBe(1);
        expect(pdf.page(1).width).toBe(612);
        expect(pdf.page(1).height).toBe(792);
        expect(pdf.page(1).rotation).toBe(0);
        expect(pdf.page(1).text()).toContain("Hello ClawPDF");
        expect(pdf.text({ maxPages: 1 })).toContain("Hello ClawPDF");
        expect([...pdf.pages()].map((page) => page.index)).toEqual([1]);
      } finally {
        pdf.destroy();
      }
    } finally {
      await engine.destroy();
    }
  });

  it("loads convenience inputs from Node paths, URLs, and Blobs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawpdf-"));
    try {
      const file = join(dir, "report.pdf");
      const bytes = makeTextPdf("Path input");
      await writeFile(file, bytes);

      await using pathPdf = await openPdf(file);
      expect(pathPdf.text()).toContain("Path input");

      await using fileUrlPdf = await openPdf(new URL(`file://${file}`));
      expect(fileUrlPdf.text()).toContain("Path input");

      await using blobPdf = await openPdf(new Blob([bytes]));
      expect(blobPdf.text()).toContain("Path input");

      const dataUrl = `data:application/pdf;base64,${Buffer.from(bytes).toString("base64")}`;
      await using dataPdf = await openPdf(dataUrl);
      expect(dataPdf.text()).toContain("Path input");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("extracts selected pages with raw image bytes and adapter output", async () => {
    const result = await extractPdf(makeTextPdf(["First page", "", "Third page"], { width: 100, height: 100 }), {
      mode: "both",
      pages: [3, 1],
      image: {
        maxDimension: 20,
        maxPixels: 800,
      },
    });

    expect(result.text).toContain("Third page");
    expect(result.text).toContain("First page");
    expect(result.pagesProcessed).toEqual([3, 1]);
    expect(result.images.map((image) => image.page)).toEqual([3, 1]);
    expect(result.images[0]?.bytes.subarray(0, 8)).toEqual(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(result.images[0]?.mimeType).toBe("image/png");
    expect(result.truncated.images).toBe(true);

    const blocks = toMessageContent(result);
    expect(blocks[0]).toMatchObject({ type: "text" });
    expect(blocks[1]).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/png" } });
    expect(toDataUrls(result)[0]).toMatch(/^data:image\/png;base64,/);
  });

  it("applies explicit maxPages to selected pages and truncates exact image budgets without throwing", async () => {
    const selected = await extractPdf(makeTextPdf(["First", "Second", "Third"], { width: 100, height: 100 }), {
      mode: "text",
      pages: [1, 2, 3],
      maxPages: 1,
    });
    expect(selected.pagesProcessed).toEqual([1]);
    expect(selected.text).toContain("First");
    expect(selected.text).not.toContain("Second");

    const exactBudget = await extractPdf(makeTextPdf(["", "", ""], { width: 100, height: 100 }), {
      mode: "images",
      pages: [1, 2, 3],
      image: {
        scale: 0.1,
        maxDimension: 10,
        maxPixels: 200,
      },
    });
    expect(exactBudget.images.map((image) => image.page)).toEqual([1, 2]);
    expect(exactBudget.truncated.images).toBe(true);

    const uncapped = await extractPdf(makeTextPdf("", { width: 72, height: 72 }), {
      mode: "images",
      image: {
        scale: 1,
        maxDimension: 100,
        maxPixels: 10_000,
      },
    });
    expect(uncapped.images).toHaveLength(1);
    expect(uncapped.truncated.images).toBe(false);
  });

  it("supports extraction modes", async () => {
    const pdf = makeTextPdf("Short", { width: 100, height: 100 });
    const textOnly = await extractPdf(pdf, { mode: "text", minTextChars: 1000 });
    expect(textOnly.text).toContain("Short");
    expect(textOnly.images).toHaveLength(0);

    const imagesOnly = await extractPdf(pdf, { mode: "images", maxPages: 1, image: { maxPixels: 1_000 } });
    expect(imagesOnly.text).toBe("");
    expect(imagesOnly.images).toHaveLength(1);

    const autoText = await extractPdf(pdf, { mode: "auto", minTextChars: 1 });
    expect(autoText.images).toHaveLength(0);

    const autoImages = await extractPdf(pdf, { mode: "auto", minTextChars: 1000, image: { maxPixels: 1_000 } });
    expect(autoImages.text).toContain("Short");
    expect(autoImages.images).toHaveLength(1);
  });

  it("renders pages with dpi, target dimensions, transparency, and PNG output", async () => {
    await using pdf = await openPdf(makeTextPdf("Render me", { width: 72, height: 36 }));

    const dpi = pdf.page(1).render({ dpi: 144 });
    expect(dpi.width).toBe(144);
    expect(dpi.height).toBe(72);
    expect(dpi.rgba.byteLength).toBe(144 * 72 * 4);

    const width = pdf.page(1).render({ width: 20 });
    expect(width).toMatchObject({ width: 20, height: 10 });

    const transparent = pdf.page(1).render({ width: 4, background: "transparent" });
    expect(transparent.rgba[3]).toBe(0);

    const png = pdf.page(1).pngSync({ scale: 1 });
    expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);

    const compressed = await pdf.page(1).png({ scale: 1 });
    expect(Array.from(compressed.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(compressed.byteLength).toBeLessThan(png.byteLength);
  });

  it("exposes embedded page rotation without applying it twice during render", async () => {
    await using pdf = await openPdf(makeTextPdf("Rotated", { width: 72, height: 36, rotate: 90 }));

    const page = pdf.page(1);
    expect(page.rotation).toBe(90);

    const rendered = page.render({ dpi: 72 });
    expect(rendered.width).toBe(page.width);
    expect(rendered.height).toBe(page.height);

    const extraRotation = page.render({ dpi: 72, rotate: 90 });
    expect(extraRotation.width).toBe(page.height);
    expect(extraRotation.height).toBe(page.width);
  });

  it("enforces typed errors for invalid input, page ranges, render budgets, and destroyed resources", async () => {
    await expect(extractPdf(new TextEncoder().encode("not a pdf"))).rejects.toBeInstanceOf(PdfFormatError);
    await expect(openPdf("/definitely/missing/report.pdf")).rejects.toBeInstanceOf(PdfFormatError);

    await using pdf = await openPdf(makeTextPdf("Errors"));
    expect(() => pdf.page(0)).toThrow(PdfPageRangeError);
    expect(() => pdf.page(2)).toThrow(PdfPageRangeError);
    expect(() => pdf.page(1).render({ dpi: 144, width: 10 })).toThrow(PdfError);
    expect(() => pdf.page(1).render({ scale: 1_000 })).toThrow(PdfBudgetError);

    const engine = await createEngine();
    const owned = await engine.open(makeTextPdf("Destroyed"));
    await engine.destroy();
    expect(() => owned.text()).toThrow(PdfDestroyedError);
    await expect(engine.open(makeTextPdf("Again"))).rejects.toThrow(PdfDestroyedError);
  });

  it("supports password-protected PDFs", async () => {
    const pdf = passwordProtectedPdf();
    await expect(openPdf(pdf)).rejects.toBeInstanceOf(PdfPasswordError);
    await expect(openPdf(pdf, { password: "wrong" })).rejects.toBeInstanceOf(PdfPasswordError);

    await using opened = await openPdf(pdf, { password: "secret" });
    expect(opened.text()).toContain("Secret ClawPDF");

    const extracted = await extractPdf(pdf, { password: "secret", mode: "text" });
    expect(extracted.text).toContain("Secret ClawPDF");
  });

  it("reuses caller-owned engines and releases the shared extraction engine", async () => {
    const engine = await createEngine();
    try {
      const first = await extractPdf(makeTextPdf("Owned engine"), { engine, mode: "text" });
      expect(first.text).toContain("Owned engine");
    } finally {
      await engine.destroy();
    }

    const [one, two] = await Promise.all([
      extractPdf(makeTextPdf("Shared one"), { mode: "text" }),
      extractPdf(makeTextPdf("Shared two"), { mode: "text" }),
    ]);
    expect(one.text).toContain("Shared one");
    expect(two.text).toContain("Shared two");
    await releaseExtractEngine();
  });

  it("encodes standalone RGBA PNGs", async () => {
    const stored = encodePng(Uint8Array.from([255, 0, 0, 255]), { width: 1, height: 1, compress: false });
    expect(Array.from(stored.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);

    const rgba = new Uint8Array(8 * 8 * 4).fill(255);
    const compressed = await encodePng(rgba, { width: 8, height: 8 });
    expect(Array.from(compressed.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(compressed.byteLength).toBeLessThan(encodePng(rgba, { width: 8, height: 8, compress: false }).byteLength);

    expect(() => encodePng(new Uint8Array(), { width: 0, height: 1, compress: false })).toThrow(PdfFormatError);
    expect(() => encodePng(new Uint8Array(3), { width: 1, height: 1, compress: false })).toThrow(PdfFormatError);
  });

  it("closes form pages when draw throws after AfterLoad", () => {
    const events: string[] = [];
    expect(() =>
      withFormPageLifecycle({
        afterLoad: () => events.push("after"),
        draw: () => {
          events.push("draw");
          throw new Error("draw failed");
        },
        beforeClose: () => events.push("beforeClose"),
      }),
    ).toThrow("draw failed");
    expect(events).toEqual(["after", "draw", "beforeClose"]);

    events.length = 0;
    withFormPageLifecycle({
      afterLoad: () => events.push("after"),
      draw: () => events.push("draw"),
      beforeClose: () => events.push("beforeClose"),
    });
    expect(events).toEqual(["after", "draw", "beforeClose"]);
  });

  it("renders PNGs with inline terminal protocols", async () => {
    const png = await encodePng(new Uint8Array(8 * 8 * 4).fill(255), { width: 8, height: 8 });
    const kitty = fakeStdout();
    expect(resolveInlineImageProtocol({
      mode: "auto",
      env: { KITTY_WINDOW_ID: "1" },
      stdout: kitty,
    })).toBe("kitty");
    expect(renderInlineImages({
      mode: "kitty",
      env: {},
      stdout: kitty,
      images: [{ data: png, name: "page-1.png", label: "Page\u001b]0;bad\u0007 1" }],
    })).toEqual({ rendered: 1, protocol: "kitty" });
    expect(kitty.output).toContain("\u001b_G");
    expect(kitty.output).not.toContain("bad");

    const iterm = fakeStdout();
    expect(renderInlineImages({
      mode: "iterm",
      env: {},
      stdout: iterm,
      images: [{ data: png, name: "page-1.png" }],
    })).toEqual({ rendered: 1, protocol: "iterm" });
    expect(iterm.output).toContain("\u001b]1337;File=");

    const pipe = fakeStdout(false);
    expect(renderInlineImages({
      mode: "auto",
      env: { KITTY_WINDOW_ID: "1" },
      stdout: pipe,
      images: [{ data: png, name: "page-1.png" }],
    })).toEqual({ rendered: 0, protocol: "none" });
  });
});

function fakeStdout(isTTY = true): NodeJS.WritableStream & { output: string; columns: number; isTTY: boolean } {
  return {
    output: "",
    columns: 80,
    isTTY,
    write(chunk: string | Uint8Array): boolean {
      this.output += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      return true;
    },
  } as NodeJS.WritableStream & { output: string; columns: number; isTTY: boolean };
}

function makeTextPdf(text: string | string[], options: { width?: number; height?: number; rotate?: 0 | 90 | 180 | 270 } = {}): Uint8Array {
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
    const rotation = options.rotate === undefined ? "" : ` /Rotate ${options.rotate}`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}]${rotation} /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObject} 0 R >>`,
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
