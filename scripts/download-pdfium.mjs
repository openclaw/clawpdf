import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const release = "7902";
const assetSha256 = "153871da7e958a9440c84648eb45ddd9ad603efda9fcd8f021766dba5a9157a2";
const wasmSha256 = "f3fe52ae7f150e912a8379ec4478cac9c11b4135dc56fdc039b0ff885f1c0981";
const cache = path.join(root, ".cache");
const archive = path.join(cache, `pdfium-lib-${release}-wasm.tgz`);
const extractDir = path.join(cache, `pdfium-lib-${release}`);

await fs.mkdir(cache, { recursive: true });
await download(
  `https://github.com/paulocoutinhox/pdfium-lib/releases/download/${release}/wasm.tgz`,
  archive,
);
await verifySha256(archive, assetSha256);
await fs.rm(extractDir, { recursive: true, force: true });
await fs.mkdir(extractDir, { recursive: true });
await run("tar", ["-xzf", archive, "-C", extractDir]);
await verifySha256(path.join(extractDir, "release", "node", "pdfium.wasm"), wasmSha256);
await verifySha256(path.join(extractDir, "release", "node", "pdfium.esm.wasm"), wasmSha256);
await fs.mkdir(path.join(root, "src", "vendor"), { recursive: true });
await fs.copyFile(
  path.join(extractDir, "release", "node", "pdfium.esm.js"),
  path.join(root, "src", "vendor", "pdfium.esm.js"),
);
await fs.copyFile(
  path.join(extractDir, "release", "node", "pdfium.esm.wasm"),
  path.join(root, "src", "vendor", "pdfium.esm.wasm"),
);
console.log(`downloaded pdfium-lib ${release}`);

async function download(url, destination) {
  try {
    await fs.access(destination);
    return;
  } catch {}
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`download failed: ${response.status} ${response.statusText}`);
  }
  await fs.writeFile(destination, new Uint8Array(await response.arrayBuffer()));
}

async function verifySha256(file, expected) {
  const hash = createHash("sha256");
  hash.update(await fs.readFile(file));
  const actual = hash.digest("hex");
  if (actual !== expected) {
    throw new Error(`${path.basename(file)} sha256 mismatch: ${actual}`);
  }
}

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} failed with ${signal ?? code}`));
      }
    });
  });
}
