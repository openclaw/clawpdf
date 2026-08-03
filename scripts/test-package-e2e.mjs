#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = process.cwd();
const temp = mkdtempSync(join(tmpdir(), "clawpdf-package-e2e-"));
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function run(command, args, options = {}) {
  if (process.platform !== "win32") {
    return execFileSync(command, args, options);
  }
  return execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/c", command, ...args], options);
}

try {
  run(pnpm, ["pack", "--pack-destination", temp], { cwd: root, stdio: "pipe" });
  const tarball = readdirSync(temp).find((entry) => entry.endsWith(".tgz"));
  if (!tarball) {
    throw new Error("pnpm pack did not produce a tarball");
  }

  const appDir = join(temp, "app");
  mkdirSync(appDir);
  run(npm, ["install", "--ignore-scripts", "--no-audit", "--no-fund", join(temp, tarball)], {
    cwd: appDir,
    stdio: "pipe",
  });

  const installedPackage = join(appDir, "node_modules", "clawpdf");
  const installedManifest = JSON.parse(readFileSync(join(installedPackage, "package.json"), "utf8"));
  assert(installedManifest.engines?.node === ">=22", "packed package must require Node.js 22 or newer");
  assert(
    existsSync(join(installedPackage, "dist", "vendor", "pdfium.esm.d.ts")),
    "packed package is missing the PDFium declaration",
  );

  const consumerSource = join(appDir, "consumer.ts");
  const consumerConfig = join(appDir, "tsconfig.json");
  writeFileSync(
    consumerSource,
    [
      'import { createEngine, type PdfEngine } from "clawpdf";',
      "",
      "export async function loadEngine(): Promise<PdfEngine> {",
      "  return createEngine();",
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    consumerConfig,
    JSON.stringify(
      {
        compilerOptions: {
          lib: ["ES2022", "DOM", "ESNext.Disposable"],
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
          skipLibCheck: false,
          strict: true,
          target: "ES2022",
        },
        files: ["consumer.ts"],
      },
      null,
      2,
    ),
  );
  run(process.execPath, [join(root, "node_modules", "typescript", "bin", "tsc"), "--project", consumerConfig], {
    cwd: appDir,
    stdio: "pipe",
  });

  const pdfPath = join(temp, "report.pdf");
  writeFileSync(pdfPath, makeTextPdf("CLI package smoke"));
  const bin = join(appDir, "node_modules", ".bin", process.platform === "win32" ? "clawpdf.cmd" : "clawpdf");

  const text = run(bin, [pdfPath], { encoding: "utf8" });
  assert(text.includes("CLI package smoke"), "text extraction output did not include PDF text");
  const renderHelp = run(bin, ["render", "--help"], { encoding: "utf8" });
  assert(renderHelp.includes("clawpdf render"), "render help did not print command help");
  assertFails(
    () => run(bin, [pdfPath, "--json", "--inline", "auto"], { encoding: "utf8", stdio: "pipe" }),
    2,
    "inline JSON conflict did not fail as invalid usage",
  );

  const json = JSON.parse(run(bin, [pdfPath, "--json"], { encoding: "utf8" }));
  assert(json.text.includes("CLI package smoke"), "JSON output did not include PDF text");

  const cappedRange = run(bin, [pdfPath, "--pages", "1-1000000000", "--max-pages", "1"], { encoding: "utf8" });
  assert(cappedRange.includes("CLI package smoke"), "page range cap extraction failed");
  assertFails(
    () => run(bin, [pdfPath, "--pages", "1-1000000000", "--max-pages", "100001"], { encoding: "utf8", stdio: "pipe" }),
    2,
    "oversized page range did not fail as invalid usage",
  );

  const imageJson = JSON.parse(run(bin, [pdfPath, "--mode", "images", "--json"], { encoding: "utf8" }));
  assert(imageJson.images[0]?.base64, "JSON image output did not include base64 PNG data");

  const imageDir = join(temp, "images");
  run(bin, [pdfPath, "--mode", "images", "--output-dir", imageDir], { encoding: "utf8" });
  assert(readFileSync(join(imageDir, "page-1.png")).subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), "output-dir PNG is invalid");

  const png = run(bin, ["render", pdfPath, "--page", "1"]);
  assert(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), "render output is not a PNG");

  const passwordPdfPath = join(temp, "secret.pdf");
  writeFileSync(passwordPdfPath, passwordProtectedPdf());
  const secret = run(bin, [passwordPdfPath, "--password", "secret"], { encoding: "utf8" });
  assert(secret.includes("Secret ClawPDF"), "password-protected extraction failed");
  const passwordPath = join(temp, "password.txt");
  writeFileSync(passwordPath, "secret\n");
  const secretFromFile = run(bin, [passwordPdfPath, "--password-file", passwordPath], { encoding: "utf8" });
  assert(secretFromFile.includes("Secret ClawPDF"), "password-file extraction failed");

  const stdinText = run(bin, ["-"], { input: readFileSync(pdfPath), encoding: "utf8" });
  assert(stdinText.includes("CLI package smoke"), "stdin extraction failed");
} finally {
  rmSync(temp, { recursive: true, force: true });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertFails(run, exitCode, message) {
  try {
    run();
  } catch (error) {
    if (error && typeof error === "object" && "status" in error && error.status === exitCode) {
      return;
    }
    throw error;
  }
  throw new Error(message);
}

function makeTextPdf(text) {
  const escaped = text.replace(/[()\\]/g, (char) => `\\${char}`);
  const content = `BT /F1 24 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [4 0 R] /Count 1 >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>`,
    `<< /Length ${Buffer.byteLength(content, "utf8")} >>\nstream\n${content}\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(body, "utf8"));
    body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body, "utf8");
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body);
}

function passwordProtectedPdf() {
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
