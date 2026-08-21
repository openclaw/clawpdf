import { execFile } from "node:child_process";
import { appendFile, cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));

describe("docs site builder", () => {
  it("builds the table of contents from parsed headings", async () => {
    const temp = await mkdtemp(join(tmpdir(), "clawpdf-docs-"));
    try {
      await cp(join(root, "docs"), join(temp, "docs"), { recursive: true });
      await appendFile(
        join(temp, "docs", "loading.md"),
        "\n## <scr<script>ipt> and [openPdf](api-reference.md) with `signal`\n",
      );

      await execFileAsync(process.execPath, [join(root, "scripts", "build-docs-site.mjs")], { cwd: temp });
      const html = await readFile(join(temp, "site", "loading.html"), "utf8");
      const toc = html.match(/<aside class="toc"[\s\S]*?<\/aside>/)?.[0];

      expect(toc).toBeDefined();
      expect(toc).toContain("&lt;scr&lt;script&gt;ipt&gt; and openPdf with signal");
      expect(toc).not.toContain("<scr<script>ipt>");
      expect(toc).not.toContain('<a href="api-reference.html">openPdf</a>');
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });
});
