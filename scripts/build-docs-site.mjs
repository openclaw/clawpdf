#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const docsDir = path.join(root, "docs");
const outDir = path.join(root, "site");
const repoBase = "https://github.com/openclaw/clawpdf";
const siteBase = "https://clawpdf.dev";

const navSections = [
  ["Start", ["index.md", "loading.md"]],
  ["Features", ["text-extraction.md", "page-rendering.md", "png-output.md", "extraction-fallback.md", "passwords.md"]],
  ["Runtime", ["browser-bundlers.md", "pdfium-provenance.md", "package-shape.md"]],
  ["Reference", ["api-reference.md", "performance.md"]],
];

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const pages = readPages();
const pageMap = new Map(pages.map((page) => [page.rel, page]));
validateNavigation(pages, pageMap);

const orderedPages = navSections.flatMap(([, rels]) => rels.map((rel) => pageMap.get(rel)));
const sectionByRel = new Map(navSections.flatMap(([section, rels]) => rels.map((rel) => [rel, section])));

for (const page of pages) {
  const html = markdownToHtml(page.body, page.rel);
  const toc = tocFromHtml(html);
  const index = orderedPages.findIndex((candidate) => candidate.rel === page.rel);
  const prev = index > 0 ? orderedPages[index - 1] : null;
  const next = index >= 0 && index < orderedPages.length - 1 ? orderedPages[index + 1] : null;
  fs.writeFileSync(
    path.join(outDir, page.outRel),
    layout({
      page,
      html,
      toc,
      prev,
      next,
      sectionName: sectionByRel.get(page.rel) ?? "Reference",
    }),
    "utf8",
  );
}

writeStaticFiles();
validateBuiltLinks();
console.log(`built docs site: ${path.relative(root, outDir)}`);

function readPages() {
  return fs
    .readdirSync(docsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => {
      const rel = entry.name;
      const raw = fs.readFileSync(path.join(docsDir, rel), "utf8");
      const { frontmatter, body } = parseFrontmatter(raw);
      const title = frontmatter.title || firstHeading(body) || titleize(path.basename(rel, ".md"));
      const description = frontmatter.description || "";
      return {
        rel,
        outRel: rel === "index.md" ? "index.html" : rel.replace(/\.md$/, ".html"),
        title,
        description,
        body,
        frontmatter,
      };
    })
    .sort((a, b) => a.rel.localeCompare(b.rel));
}

function validateNavigation(allPages, pagesByRel) {
  const navRels = new Set(navSections.flatMap(([, rels]) => rels));
  const missing = [...navRels].filter((rel) => !pagesByRel.has(rel));
  if (missing.length) {
    throw new Error(`docs nav references missing pages: ${missing.join(", ")}`);
  }

  const orphaned = allPages.map((page) => page.rel).filter((rel) => !navRels.has(rel));
  if (orphaned.length) {
    throw new Error(`docs pages missing from nav: ${orphaned.join(", ")}`);
  }
}

function writeStaticFiles() {
  fs.writeFileSync(path.join(outDir, "favicon.svg"), faviconSvg(), "utf8");
  fs.writeFileSync(path.join(outDir, ".nojekyll"), "", "utf8");
  fs.writeFileSync(path.join(outDir, "llms.txt"), llmsTxt(), "utf8");

  const cnamePath = path.join(docsDir, "CNAME");
  if (fs.existsSync(cnamePath)) {
    fs.copyFileSync(cnamePath, path.join(outDir, "CNAME"));
  }
}

function layout({ page, html, toc, prev, next, sectionName }) {
  const pageTitle = page.rel === "index.md" ? "ClawPDF" : `${page.title} - ClawPDF`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(pageTitle)}</title>
  <meta name="description" content="${escapeHtml(page.description || "ClawPDF documentation")}">
  <meta property="og:title" content="${escapeHtml(pageTitle)}">
  <meta property="og:description" content="${escapeHtml(page.description || "Zero-dependency PDFium WebAssembly bindings.")}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${escapeHtml(`${siteBase}/${page.outRel === "index.html" ? "" : page.outRel}`)}">
  <link rel="icon" href="favicon.svg" type="image/svg+xml">
  <style>${css()}</style>
  <script>${preThemeScript()}</script>
</head>
<body>
  <button class="skip-link" onclick="document.querySelector('main').focus()">Skip to content</button>
  <div class="shell">
    <aside class="sidebar" id="sidebar">
      <div class="brand">
        <a href="index.html" aria-label="ClawPDF home" class="brand-mark">${faviconSvg()}</a>
        <div>
          <a href="index.html" class="brand-name">ClawPDF</a>
          <div class="brand-tag">PDFium WASM, zero deps</div>
        </div>
      </div>
      <label class="search">
        <span>Search docs</span>
        <input id="nav-search" type="search" placeholder="Filter pages" autocomplete="off">
      </label>
      <nav aria-label="Documentation">
        ${navHtml(page.rel)}
      </nav>
    </aside>
    <div class="content">
      <header class="topbar">
        <button class="icon-button" id="menu-button" aria-label="Open navigation" aria-expanded="false">
          <span></span><span></span><span></span>
        </button>
        <a class="repo-link" href="${repoBase}">GitHub</a>
        <button class="theme-button" id="theme-toggle" type="button" aria-label="Toggle color theme">
          <span class="sun">Light</span><span class="moon">Dark</span>
        </button>
      </header>
      <main tabindex="-1">
        <div class="article-grid">
          <article class="article">
            <div class="eyebrow">${escapeHtml(sectionName)}</div>
            ${html}
            ${pagerHtml(prev, next)}
          </article>
          <aside class="toc" aria-label="On this page">
            <div class="toc-title">On this page</div>
            ${toc}
          </aside>
        </div>
      </main>
    </div>
  </div>
  <script>${js()}</script>
</body>
</html>`;
}

function navHtml(activeRel) {
  return navSections
    .map(([name, rels]) => {
      const links = rels
        .map((rel) => {
          const page = pageMap.get(rel);
          const active = rel === activeRel ? " aria-current=\"page\"" : "";
          return `<a href="${page.outRel}" data-title="${escapeHtml(page.title.toLowerCase())}"${active}>${escapeHtml(page.title)}</a>`;
        })
        .join("");
      return `<section><h2>${escapeHtml(name)}</h2>${links}</section>`;
    })
    .join("");
}

function pagerHtml(prev, next) {
  if (!prev && !next) return "";
  return `<nav class="pager" aria-label="Previous and next pages">
    ${prev ? `<a href="${prev.outRel}" rel="prev"><span>Previous</span>${escapeHtml(prev.title)}</a>` : "<span></span>"}
    ${next ? `<a href="${next.outRel}" rel="next"><span>Next</span>${escapeHtml(next.title)}</a>` : "<span></span>"}
  </nav>`;
}

function markdownToHtml(markdown, fromRel) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let paragraph = [];
  let list = null;
  let blockquote = [];
  let code = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    out.push(`<p>${inlineMarkdown(paragraph.join(" "), fromRel)}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    out.push(`<${list.type}>${list.items.map((item) => `<li>${inlineMarkdown(item, fromRel)}</li>`).join("")}</${list.type}>`);
    list = null;
  };
  const flushBlockquote = () => {
    if (!blockquote.length) return;
    out.push(`<blockquote><p>${inlineMarkdown(blockquote.join(" "), fromRel)}</p></blockquote>`);
    blockquote = [];
  };
  const flushLoose = () => {
    flushParagraph();
    flushList();
    flushBlockquote();
  };

  for (const line of lines) {
    const fence = line.match(/^```(\w+)?\s*$/);
    if (fence) {
      if (code) {
        out.push(codeBlock(code.lang, code.lines.join("\n")));
        code = null;
      } else {
        flushLoose();
        code = { lang: fence[1] || "", lines: [] };
      }
      continue;
    }
    if (code) {
      code.lines.push(line);
      continue;
    }

    if (!line.trim()) {
      flushLoose();
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushLoose();
      const level = heading[1].length;
      const text = heading[2].trim();
      const id = slugify(text);
      out.push(`<h${level} id="${id}"><a class="anchor" href="#${id}" aria-label="Link to ${escapeHtml(text)}">#</a>${inlineMarkdown(text, fromRel)}</h${level}>`);
      continue;
    }

    const unordered = line.match(/^\s*-\s+(.+)$/);
    if (unordered) {
      flushParagraph();
      flushBlockquote();
      if (!list || list.type !== "ul") {
        flushList();
        list = { type: "ul", items: [] };
      }
      list.items.push(unordered[1]);
      continue;
    }

    const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      flushBlockquote();
      if (!list || list.type !== "ol") {
        flushList();
        list = { type: "ol", items: [] };
      }
      list.items.push(ordered[1]);
      continue;
    }

    const quote = line.match(/^>\s+(.+)$/);
    if (quote) {
      flushParagraph();
      flushList();
      blockquote.push(quote[1]);
      continue;
    }

    flushList();
    flushBlockquote();
    paragraph.push(line.trim());
  }

  if (code) out.push(codeBlock(code.lang, code.lines.join("\n")));
  flushLoose();
  return out.join("\n");
}

function codeBlock(lang, source) {
  const language = lang ? ` data-lang="${escapeHtml(lang)}"` : "";
  const label = lang ? `<span>${escapeHtml(lang)}</span>` : "<span>code</span>";
  return `<div class="code-wrap"${language}>${label}<button type="button" class="copy-button">Copy</button><pre><code>${escapeHtml(source)}</code></pre></div>`;
}

function inlineMarkdown(text, fromRel) {
  const codeSpans = [];
  const withoutCode = text.replace(/`([^`]+)`/g, (_, code) => {
    const token = `\u0000CODE${codeSpans.length}\u0000`;
    codeSpans.push(`<code>${escapeHtml(code)}</code>`);
    return token;
  });
  const escaped = escapeHtml(withoutCode)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
      const resolved = resolveHref(href, fromRel);
      return `<a href="${escapeHtml(resolved)}">${label}</a>`;
    });
  return escaped.replace(/\u0000CODE(\d+)\u0000/g, (_, index) => codeSpans[Number(index)]);
}

function resolveHref(href, fromRel) {
  if (/^(?:https?:|mailto:|#)/.test(href)) return href;
  if (href.endsWith(".md")) return href.replace(/\.md$/, ".html");
  if (href.includes(".md#")) return href.replace(/\.md#/, ".html#");
  return href;
}

function tocFromHtml(html) {
  const items = [...html.matchAll(/<h([23]) id="([^"]+)">.*?<\/h\1>/g)].map((match) => ({
    level: Number(match[1]),
    id: match[2],
    title: stripTags(match[0]).replace(/^#/, ""),
  }));
  if (!items.length) return "<p>No sections.</p>";
  return `<ol>${items.map((item) => `<li class="toc-l${item.level}"><a href="#${item.id}">${escapeHtml(item.title)}</a></li>`).join("")}</ol>`;
}

function validateBuiltLinks() {
  const htmlFiles = fs.readdirSync(outDir).filter((name) => name.endsWith(".html"));
  const valid = new Set([...htmlFiles, "favicon.svg", "llms.txt"]);
  const missing = [];
  for (const file of htmlFiles) {
    const source = fs.readFileSync(path.join(outDir, file), "utf8");
    for (const [, href] of source.matchAll(/\shref="([^"]+)"/g)) {
      if (/^(?:https?:|mailto:|#)/.test(href)) continue;
      const target = href.split("#")[0];
      if (target && !valid.has(target)) missing.push(`${file} -> ${href}`);
    }
  }
  if (missing.length) throw new Error(`broken docs links:\n${missing.join("\n")}`);
}

function parseFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { frontmatter: {}, body: raw };
  const frontmatter = {};
  for (const line of match[1].split("\n")) {
    const parsed = line.match(/^([A-Za-z0-9_-]+):\s*(.*?)\s*$/);
    if (!parsed) continue;
    frontmatter[parsed[1]] = parsed[2].replace(/^["']|["']$/g, "");
  }
  return { frontmatter, body: raw.slice(match[0].length) };
}

function firstHeading(markdown) {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
}

function titleize(value) {
  return value
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function stripTags(value) {
  return value.replace(/<[^>]+>/g, "");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function llmsTxt() {
  const lines = [
    "# ClawPDF",
    "",
    "Zero-dependency PDFium WebAssembly bindings for PDF text extraction, page rendering, and PNG fallback images.",
    "",
    "Canonical documentation:",
    ...orderedPages.map((page) => `- ${page.title}: ${siteBase}/${page.outRel === "index.html" ? "" : page.outRel}`),
    "",
    "Install:",
    "- npm install clawpdf",
    "",
    `Source: ${repoBase}`,
    "",
    "Guidance for agents:",
    "- Prefer these docs over package metadata snippets.",
    "- Fetch only the pages needed for the current task.",
  ];
  return `${lines.join("\n")}\n`;
}

function faviconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="ClawPDF logo">
  <rect width="64" height="64" rx="14" fill="#17212f"/>
  <path d="M18 13h22l9 9v29H18z" fill="#f7fbff"/>
  <path d="M40 13v10h9" fill="#d7e6f5"/>
  <path d="M24 39c6 5 14 5 20 0" fill="none" stroke="#e0473d" stroke-width="4" stroke-linecap="round"/>
  <path d="M26 30h13" stroke="#17212f" stroke-width="4" stroke-linecap="round"/>
</svg>`;
}

function preThemeScript() {
  return `(() => {
  const saved = localStorage.getItem("theme");
  const theme = saved || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.dataset.theme = theme;
})();`;
}

function js() {
  return `const sidebar = document.querySelector("#sidebar");
const menu = document.querySelector("#menu-button");
menu?.addEventListener("click", () => {
  const open = sidebar.classList.toggle("is-open");
  menu.setAttribute("aria-expanded", String(open));
});

document.querySelector("#theme-toggle")?.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("theme", next);
});

document.querySelector("#nav-search")?.addEventListener("input", (event) => {
  const query = event.currentTarget.value.trim().toLowerCase();
  document.querySelectorAll("nav a[data-title]").forEach((link) => {
    link.hidden = query.length > 0 && !link.dataset.title.includes(query);
  });
});

document.querySelectorAll(".copy-button").forEach((button) => {
  button.addEventListener("click", async () => {
    const code = button.parentElement?.querySelector("code")?.textContent || "";
    await navigator.clipboard.writeText(code);
    button.textContent = "Copied";
    setTimeout(() => { button.textContent = "Copy"; }, 1400);
  });
});`;
}

function css() {
  return String.raw`
:root {
  color-scheme: light;
  --bg: #f7f9fb;
  --panel: #ffffff;
  --panel-soft: #eef4f7;
  --text: #17212f;
  --muted: #617084;
  --line: #dce5ec;
  --accent: #e0473d;
  --accent-2: #087f8c;
  --code-bg: #101826;
  --code-text: #eef6ff;
  --shadow: 0 18px 48px rgba(23, 33, 47, 0.10);
}

:root[data-theme="dark"] {
  color-scheme: dark;
  --bg: #0d121a;
  --panel: #131b26;
  --panel-soft: #182331;
  --text: #eef6ff;
  --muted: #9fb0c3;
  --line: #253244;
  --accent: #ff6b5f;
  --accent-2: #33c2cf;
  --code-bg: #090d13;
  --code-text: #eef6ff;
  --shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 16px/1.65 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  overflow-x: hidden;
}
a { color: var(--accent-2); text-decoration-thickness: 0.08em; text-underline-offset: 0.18em; }
a:hover { color: var(--accent); }
.skip-link {
  position: fixed;
  left: 1rem;
  top: 1rem;
  z-index: 20;
  transform: translateY(-180%);
}
.skip-link:focus { transform: translateY(0); }
.shell { display: grid; grid-template-columns: 290px minmax(0, 1fr); min-height: 100vh; }
.sidebar {
  position: sticky;
  top: 0;
  height: 100vh;
  overflow-y: auto;
  border-right: 1px solid var(--line);
  background: var(--panel);
  padding: 1.25rem;
}
.brand { display: flex; gap: 0.8rem; align-items: center; margin-bottom: 1.4rem; }
.brand-mark {
  display: grid;
  width: 44px;
  height: 44px;
  place-items: center;
  border-radius: 8px;
  box-shadow: var(--shadow);
}
.brand-mark svg { width: 44px; height: 44px; display: block; }
.brand-name { display: block; color: var(--text); font-weight: 780; font-size: 1.18rem; text-decoration: none; }
.brand-tag { color: var(--muted); font-size: 0.82rem; line-height: 1.2; }
.search { display: block; margin-bottom: 1.3rem; color: var(--muted); font-size: 0.74rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
.search input {
  width: 100%;
  margin-top: 0.45rem;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel-soft);
  color: var(--text);
  padding: 0.64rem 0.72rem;
  font: inherit;
}
nav section { margin: 1.2rem 0; }
nav h2 {
  margin: 0 0 0.35rem;
  color: var(--muted);
  font-size: 0.74rem;
  font-weight: 760;
  text-transform: uppercase;
  letter-spacing: 0.07em;
}
nav a {
  display: block;
  padding: 0.48rem 0.62rem;
  border-radius: 8px;
  color: var(--text);
  text-decoration: none;
  font-weight: 560;
  line-height: 1.28;
}
nav a:hover { background: var(--panel-soft); color: var(--text); }
nav a[aria-current="page"] { background: color-mix(in srgb, var(--accent-2) 14%, transparent); color: var(--accent-2); }
.content { min-width: 0; }
.topbar {
  position: sticky;
  top: 0;
  z-index: 8;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 0.7rem;
  min-height: 60px;
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--bg) 88%, transparent);
  backdrop-filter: blur(14px);
  padding: 0 1.6rem;
}
.repo-link,
.theme-button,
.icon-button,
.copy-button {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  color: var(--text);
  font: inherit;
  font-weight: 680;
  text-decoration: none;
  cursor: pointer;
}
.repo-link,
.theme-button { padding: 0.45rem 0.72rem; }
.theme-button .moon { display: none; }
:root[data-theme="dark"] .theme-button .sun { display: none; }
:root[data-theme="dark"] .theme-button .moon { display: inline; }
.icon-button {
  display: none;
  width: 42px;
  height: 38px;
  padding: 0.55rem;
  margin-right: auto;
}
.icon-button span { display: block; height: 2px; margin: 4px 0; background: var(--text); border-radius: 999px; }
main { padding: 3.2rem 2rem 4rem; outline: none; }
.article-grid {
  display: grid;
  grid-template-columns: minmax(0, 780px) 230px;
  gap: 4rem;
  max-width: 1120px;
  margin: 0 auto;
}
.article {
  min-width: 0;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: clamp(1.4rem, 4vw, 3rem);
  box-shadow: var(--shadow);
  overflow-wrap: anywhere;
}
.eyebrow {
  color: var(--accent);
  font-size: 0.77rem;
  font-weight: 780;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
h1 {
  margin: 0.18rem 0 1rem;
  font-size: clamp(2.2rem, 5vw, 4.6rem);
  line-height: 0.98;
  letter-spacing: 0;
}
h2 { margin: 2.1rem 0 0.65rem; font-size: 1.5rem; line-height: 1.2; letter-spacing: 0; }
h3 { margin: 1.5rem 0 0.45rem; font-size: 1.12rem; letter-spacing: 0; }
h4 { margin: 1.2rem 0 0.3rem; font-size: 1rem; letter-spacing: 0; }
h1 + p { color: var(--muted); font-size: 1.12rem; }
p, ul, ol, blockquote { margin: 0.7rem 0 1rem; }
ul, ol { padding-left: 1.4rem; }
li + li { margin-top: 0.2rem; }
blockquote {
  border-left: 4px solid var(--accent-2);
  color: var(--muted);
  padding-left: 1rem;
}
code {
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--panel-soft);
  padding: 0.08rem 0.28rem;
  font: 0.92em ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.code-wrap {
  position: relative;
  margin: 1rem 0 1.3rem;
  border-radius: 8px;
  background: var(--code-bg);
  color: var(--code-text);
  overflow: hidden;
  max-width: 100%;
  min-width: 0;
}
.code-wrap > span {
  position: absolute;
  left: 0.85rem;
  top: 0.62rem;
  color: #9fb0c3;
  font-size: 0.74rem;
  font-weight: 760;
  text-transform: uppercase;
}
.copy-button {
  position: absolute;
  top: 0.48rem;
  right: 0.5rem;
  padding: 0.24rem 0.52rem;
  color: var(--code-text);
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.18);
  font-size: 0.78rem;
}
pre {
  margin: 0;
  padding: 2.7rem 1rem 1rem;
  overflow-x: auto;
  line-height: 1.5;
  max-width: 100%;
  min-width: 0;
}
pre code {
  border: 0;
  background: transparent;
  color: inherit;
  padding: 0;
}
.anchor {
  margin-left: -1.05em;
  padding-right: 0.35em;
  opacity: 0;
  text-decoration: none;
}
h2:hover .anchor,
h3:hover .anchor,
h4:hover .anchor { opacity: 0.75; }
.toc {
  position: sticky;
  top: 84px;
  align-self: start;
  color: var(--muted);
  font-size: 0.9rem;
}
.toc-title { color: var(--text); font-weight: 780; margin-bottom: 0.5rem; }
.toc ol { list-style: none; padding: 0; margin: 0; }
.toc li { margin: 0.28rem 0; }
.toc-l3 { padding-left: 0.8rem; }
.toc a { color: var(--muted); text-decoration: none; }
.toc a:hover { color: var(--accent-2); }
.pager {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.8rem;
  margin-top: 2.4rem;
  padding-top: 1.4rem;
  border-top: 1px solid var(--line);
}
.pager a {
  display: block;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 0.8rem;
  background: var(--panel-soft);
  color: var(--text);
  text-decoration: none;
  font-weight: 760;
}
.pager a:last-child { text-align: right; }
.pager span { display: block; color: var(--muted); font-size: 0.76rem; text-transform: uppercase; letter-spacing: 0.06em; }

@media (max-width: 980px) {
  .shell { grid-template-columns: 1fr; }
  .content { width: 100vw; max-width: 100vw; overflow: hidden; }
  .topbar { width: 100vw; max-width: 100vw; }
  .sidebar {
    position: fixed;
    z-index: 12;
    width: min(86vw, 330px);
    transform: translateX(-105%);
    transition: transform 160ms ease;
  }
  .sidebar.is-open { transform: translateX(0); }
  .icon-button { display: inline-block; }
  .article-grid {
    width: calc(100vw - 2rem);
    max-width: calc(100vw - 2rem);
    grid-template-columns: minmax(0, 1fr);
    gap: 1.4rem;
  }
  .article { width: 100%; max-width: 100%; }
  .toc { display: none; }
  main { padding: 1.4rem 1rem 3rem; }
}

@media (max-width: 560px) {
  .topbar { padding: 0 0.75rem; }
  .repo-link,
  .theme-button { padding: 0.42rem 0.55rem; }
  .article { padding: 1.15rem; }
  h1 { font-size: 2.25rem; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; }
  .pager { grid-template-columns: 1fr; }
  .pager a:last-child { text-align: left; }
}
`;
}
