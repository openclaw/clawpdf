#!/usr/bin/env node
import { execFile, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const root = process.cwd();
const temp = mkdtempSync(join(tmpdir(), "clawpdf-package-e2e-"));
const npmCli = findNpmCli();

try {
  runNpm(["pack", "--ignore-scripts", "--pack-destination", temp], { cwd: root, stdio: "pipe" });
  const tarball = readdirSync(temp).find((entry) => entry.endsWith(".tgz"));
  if (!tarball) {
    throw new Error("npm pack did not produce a tarball");
  }

  const appDir = join(temp, "app");
  mkdirSync(appDir);
  runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund", join(temp, tarball)], {
    cwd: appDir,
    stdio: "pipe",
  });

  const installedPackage = join(appDir, "node_modules", "clawpdf");
  const installedManifest = JSON.parse(readFileSync(join(installedPackage, "package.json"), "utf8"));
  assert(installedManifest.engines?.node === ">=22", "packed package must require Node.js 22 or newer");
  assert(installedManifest.bin?.clawpdf === "dist/cli.js", "packed package must expose the clawpdf CLI");
  assert(
    existsSync(join(installedPackage, "dist", "vendor", "pdfium.esm.d.ts")),
    "packed package is missing the PDFium declaration",
  );

  const consumerSource = join(appDir, "consumer.ts");
  const consumerConfig = join(appDir, "tsconfig.json");
  writeFileSync(
    consumerSource,
    [
      'import { createEngine, openPdf, type PdfEngine } from "clawpdf";',
      "",
      "export async function loadEngine(): Promise<PdfEngine> {",
      "  return createEngine();",
      "}",
      "",
      "export function loadRemote(url: URL, signal: AbortSignal) {",
      "  return openPdf(url, { fetchTimeoutMs: 10_000, fetchMaxBytes: 10_000_000, signal });",
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
  execFileSync(process.execPath, [join(root, "node_modules", "typescript", "bin", "tsc"), "--project", consumerConfig], {
    cwd: appDir,
    stdio: "pipe",
  });

  const pdfPath = join(temp, "report.pdf");
  writeFileSync(pdfPath, makeTextPdf("CLI package smoke"));
  const cli = join(installedPackage, "dist", "cli.js");
  const bin = join(appDir, "node_modules", ".bin", process.platform === "win32" ? "clawpdf.cmd" : "clawpdf");
  assert(existsSync(bin), "npm install did not create the clawpdf executable");

  const text = runCli(cli, [pdfPath], { encoding: "utf8" });
  assert(text.includes("CLI package smoke"), "text extraction output did not include PDF text");
  const renderHelp = runCli(cli, ["render", "--help"], { encoding: "utf8" });
  assert(renderHelp.includes("clawpdf render"), "render help did not print command help");
  assert(renderHelp.includes("--fetch-max-bytes"), "help did not document the HTTP body budget");
  await testRemoteInputs(installedPackage, cli);
  assertFails(
    () => runCli(cli, [pdfPath, "--json", "--inline", "auto"], { encoding: "utf8", stdio: "pipe" }),
    2,
    "inline JSON conflict did not fail as invalid usage",
  );

  const json = JSON.parse(runCli(cli, [pdfPath, "--json"], { encoding: "utf8" }));
  assert(json.text.includes("CLI package smoke"), "JSON output did not include PDF text");

  const cappedRange = runCli(cli, [pdfPath, "--pages", "1-1000000000", "--max-pages", "1"], { encoding: "utf8" });
  assert(cappedRange.includes("CLI package smoke"), "page range cap extraction failed");
  assertFails(
    () => runCli(cli, [pdfPath, "--pages", "1-1000000000", "--max-pages", "100001"], { encoding: "utf8", stdio: "pipe" }),
    2,
    "oversized page range did not fail as invalid usage",
  );

  const imageJson = JSON.parse(runCli(cli, [pdfPath, "--mode", "images", "--json"], { encoding: "utf8" }));
  assert(imageJson.images[0]?.base64, "JSON image output did not include base64 PNG data");

  const imageDir = join(temp, "images");
  runCli(cli, [pdfPath, "--mode", "images", "--output-dir", imageDir], { encoding: "utf8" });
  assert(readFileSync(join(imageDir, "page-1.png")).subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), "output-dir PNG is invalid");

  const png = runCli(cli, ["render", pdfPath, "--page", "1"]);
  assert(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), "render output is not a PNG");

  const passwordPdfPath = join(temp, "secret.pdf");
  writeFileSync(passwordPdfPath, passwordProtectedPdf());
  const secret = runCli(cli, [passwordPdfPath, "--password", "secret"], { encoding: "utf8" });
  assert(secret.includes("Secret ClawPDF"), "password-protected extraction failed");
  const passwordPath = join(temp, "password.txt");
  writeFileSync(passwordPath, "secret\n");
  const secretFromFile = runCli(cli, [passwordPdfPath, "--password-file", passwordPath], { encoding: "utf8" });
  assert(secretFromFile.includes("Secret ClawPDF"), "password-file extraction failed");

  const stdinText = runCli(cli, ["-"], { input: readFileSync(pdfPath), encoding: "utf8" });
  assert(stdinText.includes("CLI package smoke"), "stdin extraction failed");
  await testRemoteFailureCleanup(installedPackage, cli);
} finally {
  rmSync(temp, { recursive: true, force: true });
}

function findNpmCli() {
  let current = dirname(realpathSync(process.execPath));
  while (true) {
    for (const candidate of [
      join(current, "node_modules", "npm", "bin", "npm-cli.js"),
      join(current, "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    ]) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`Could not find npm CLI next to ${process.execPath}`);
    }
    current = parent;
  }
}

async function testRemoteFailureCleanup(installedPackage, cli) {
  const { openPdf, PdfFormatError } = await import(pathToFileURL(join(installedPackage, "dist", "index.js")).href);
  const { main } = await import(pathToFileURL(cli).href);
  const closed = new Set();
  const server = createServer((request, response) => {
    response.on("close", () => closed.add(request.url));
    response.writeHead(503, { "Content-Type": "application/pdf" });
    response.write("unread error body");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const failures = [];
  try {
    for (const path of ["/library", "/cli-extract", "/cli-render"]) {
      if (path === "/library") {
        let failure;
        try {
          const pdf = await openPdf(`${base}${path}`);
          pdf.destroy();
        } catch (error) {
          failure = error;
        }
        assert(failure instanceof PdfFormatError && failure.message.includes("503"), "HTTP error lost its format error/status");
      } else {
        const args = path === "/cli-render" ? ["render", "--page", "1"] : ["extract"];
        assert(await main([...args, `${base}${path}`]) === 3, "CLI HTTP error lost its input-error exit code");
      }
      const deadline = Date.now() + 2_000;
      while (!closed.has(path) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      console.log(`HTTP 503 ${path}: response ${closed.has(path) ? "closed" : "still open"}`);
      if (!closed.has(path)) failures.push(path);
    }
    assert(failures.length === 0, `HTTP error responses kept downloading: ${failures.join(", ")}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function testRemoteInputs(installedPackage, cli) {
  const { openPdf, extractPdf, releaseExtractEngine, PdfBudgetError } = await import(
    pathToFileURL(join(installedPackage, "dist", "index.js")).href
  );
  const bytes = makeTextPdf("Remote package smoke");
  const largeBytes = makeTextPdf("Large remote package smoke", 100_000_000);
  assert(largeBytes.length > 100_000_000, "large HTTP fixture must exceed 100 MB");
  const closed = new Set();
  const server = createServer((request, response) => {
    response.on("close", () => closed.add(request.url));
    if (request.url === "/declared" || request.url === "/declared-unsafe") {
      response.writeHead(200, { "Content-Length": request.url === "/declared" ? "100000001" : "9007199254740992" });
      response.flushHeaders();
    } else if (request.url === "/chunked") {
      response.write(bytes);
    } else if (request.url === "/error") {
      response.writeHead(503);
      response.flushHeaders();
    } else if (request.url === "/large") {
      response.writeHead(200, { "Content-Length": largeBytes.length });
      response.end(largeBytes);
    } else {
      response.writeHead(200, { "Content-Length": bytes.length });
      response.end(bytes);
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const run = async (args) => {
    try {
      const result = await promisify(execFile)(process.execPath, [cli, ...args], { encoding: "buffer", timeout: 10_000 });
      return { ...result, code: 0 };
    } catch (error) {
      if (typeof error.code !== "number") throw error;
      return error;
    }
  };
  try {
    for (const options of [{}, { fetchMaxBytes: 0 }]) {
      const pdf = await openPdf(`${url}/large`, options);
      try {
        assert(pdf.text().includes("Large remote package smoke"), "uncapped library read over 100 MB failed");
      } finally {
        pdf.destroy();
      }
    }
    let budgetError;
    try {
      const pdf = await openPdf(`${url}/large`, { fetchMaxBytes: 100_000_000 });
      pdf.destroy();
    } catch (error) {
      budgetError = error;
    }
    assert(budgetError instanceof PdfBudgetError && budgetError.limit === "fetchMaxBytes",
      "explicit library budget did not reject a PDF over 100 MB");
    for (const command of [[], ["extract"], ["render", "--page", "1"]]) {
      const capped = await run([...command, `${url}/ok`, "--fetch-max-bytes", "32"]);
      assert(capped.code === 5 && capped.stderr.includes("fetch budget"), "CLI did not enforce HTTP budget");
      for (const budget of [String(bytes.length), "0"]) {
        const result = await run([...command, `${url}/ok`, "--fetch-max-bytes", budget]);
        assert(result.code === 0, "CLI did not forward the HTTP budget override");
        assert(command[0] === "render"
          ? result.stdout.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : result.stdout.includes("Remote package smoke"), "remote CLI output was invalid");
      }
      for (const invalid of ["-1", "1.5", "Infinity", "9007199254740992", "nope"]) {
        const result = await run([...command, `${url}/ok`, "--fetch-max-bytes", invalid]);
        assert(result.code === 2, "invalid HTTP budget did not return usage error");
      }
      const declaredCap = await run([...command, `${url}/declared`, "--fetch-max-bytes", "100000000"]);
      assert(declaredCap.code === 5, "CLI did not reject an oversized declared length with an explicit budget");
      const large = await run([...command, `${url}/large`]);
      assert(large.code === 0, "CLI capped a PDF over 100 MB by default");
      assert(command[0] === "render"
        ? large.stdout.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : large.stdout.includes("Large remote package smoke"), "large remote CLI output was invalid");
      const largeCapped = await run([...command, `${url}/large`, "--fetch-max-bytes", "100000000"]);
      assert(largeCapped.code === 5 && largeCapped.stderr.includes("fetch budget"),
        "explicit CLI budget did not reject a PDF over 100 MB");
    }
    for (const path of ["/declared", "/declared-unsafe", "/chunked"]) {
      closed.delete(path);
      try {
        const pdf = await openPdf(`${url}${path}`, { fetchMaxBytes: 32 });
        pdf.destroy();
        throw new Error("oversize HTTP body was accepted");
      } catch (error) {
        assert(error instanceof PdfBudgetError, "oversize HTTP body lost its typed budget error");
      }
      await waitForClose(path);
    }
    const result = await extractPdf(`${url}/ok`, { fetchMaxBytes: bytes.length });
    assert(result.text.includes("Remote package smoke"), "packaged library HTTP extraction failed");
    try {
      const pdf = await openPdf(`${url}/error`);
      pdf.destroy();
      throw new Error("HTTP error was accepted");
    } catch (error) {
      assert(error.message.includes("503"), "HTTP status error was lost");
    }
    await waitForClose("/error");
    console.log(`Large HTTP proof: ${largeBytes.length} bytes accepted by default and rejected with an explicit 100 MB budget in the library and CLI`);
    console.log("Remote package proof: CLI extract/render limits, overrides, PNG/text output, library reads, and rejected-body cleanup passed");
  } finally {
    await releaseExtractEngine();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }

  async function waitForClose(path) {
    const deadline = Date.now() + 2_000;
    while (!closed.has(path) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert(closed.has(path), `rejected response ${path} kept downloading`);
  }
}

function runNpm(args, options = {}) {
  return execFileSync(process.execPath, [npmCli, ...args], options);
}

function runCli(cli, args, options = {}) {
  return execFileSync(process.execPath, [cli, ...args], options);
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

function makeTextPdf(text, paddingBytes = 0) {
  const escaped = text.replace(/[()\\]/g, (char) => `\\${char}`);
  const content = `BT /F1 24 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [4 0 R] /Count 1 >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>`,
    `<< /Length ${Buffer.byteLength(content, "utf8")} >>\nstream\n${content}\nendstream`,
  ];
  if (paddingBytes > 0) {
    // An unused stream enlarges the download without expensive page rendering.
    objects.push(`<< /Length ${paddingBytes} >>\nstream\n${" ".repeat(paddingBytes)}\nendstream`);
  }
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
