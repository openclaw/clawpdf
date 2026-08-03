import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "src", "vendor");
const target = path.join(root, "dist", "vendor");

await fs.mkdir(target, { recursive: true });
await fs.copyFile(path.join(source, "pdfium.esm.d.ts"), path.join(target, "pdfium.esm.d.ts"));
await fs.copyFile(path.join(source, "pdfium.esm.js"), path.join(target, "pdfium.esm.js"));
await fs.copyFile(path.join(source, "pdfium.esm.wasm"), path.join(target, "pdfium.esm.wasm"));
