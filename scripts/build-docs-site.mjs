#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const docsDir = path.join(root, "docs");
const outDir = path.join(root, "site");
const repoBase = "https://github.com/openclaw/clawpdf";
const repoEditBase = `${repoBase}/edit/main/docs`;
const customDomain = readCname();
const siteBase = customDomain ? `https://${customDomain}` : "";
const productName = "ClawPDF";
const productTagline = "PDFium WASM, zero deps";
const productDescription =
  "Small ESM bindings for PDF text extraction, page rendering, and PNG fallback images in Node and browsers.";
const installCommand = "npm install clawpdf";

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

function readCname() {
  const cnamePath = path.join(docsDir, "CNAME");
  return fs.existsSync(cnamePath) ? fs.readFileSync(cnamePath, "utf8").trim() : "";
}

function layout({ page, html, toc, prev, next, sectionName }) {
  const home = page.rel === "index.md";
  const pageTitle = home ? `${productName} - ${productTagline}` : `${page.title} - ${productName}`;
  const description = page.description || (home ? productDescription : `${page.title} documentation for ${productName}.`);
  const canonicalUrl = canonicalPageUrl(page);
  const hero = home ? homeHero() : standardHero(page, sectionName);
  const tocHtml = home
    ? ""
    : `<aside class="toc" aria-label="On this page"><div class="toc-title">On this page</div>${toc}</aside>`;
  const bodyClass = home ? ' class="home"' : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(pageTitle)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  <meta property="og:title" content="${escapeHtml(pageTitle)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  <link rel="icon" href="favicon.svg" type="image/svg+xml">
  <script>${preThemeScript()}</script>
  <style>${css()}</style>
</head>
<body${bodyClass}>
  <a class="skip-link" href="#content">Skip to content</a>
  <button class="nav-toggle" id="menu-button" type="button" aria-label="Toggle navigation" aria-expanded="false">
    <span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span>
  </button>
  <div class="shell">
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-head">
        <a href="index.html" aria-label="ClawPDF home" class="brand">
          <span class="mark" aria-hidden="true">${faviconSvg()}</span>
          <span><strong>${productName}</strong><small>${productTagline}</small></span>
        </a>
        <button class="theme-toggle" id="theme-toggle" type="button" aria-label="Toggle color theme">
          <svg class="theme-icon theme-icon-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"></path></svg>
          <svg class="theme-icon theme-icon-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A7.5 7.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z"></path></svg>
        </button>
      </div>
      <label class="search">
        <span>Search</span>
        <input id="nav-search" type="search" placeholder="Filter pages" autocomplete="off">
      </label>
      <nav aria-label="Documentation">
        ${navHtml(page.rel)}
      </nav>
    </aside>
    <main id="content" tabindex="-1">
      ${hero}
      <div class="doc-grid${home ? " doc-grid-home" : ""}">
        <article class="doc${home ? " doc-home" : ""}">
          ${html}
          ${home ? "" : pagerHtml(prev, next)}
        </article>
        ${tocHtml}
      </div>
    </main>
  </div>
  <script>${js()}</script>
</body>
</html>`;
}

function canonicalPageUrl(page) {
  if (!siteBase) return page.outRel;
  return page.outRel === "index.html" ? `${siteBase}/` : `${siteBase}/${page.outRel}`;
}

function homeHero() {
  const featurePills = ["Text extraction", "Page rendering", "PNG fallback", "Browser export", "No native canvas"];
  return `<header class="home-hero">
        <p class="eyebrow">PDFium WebAssembly bindings</p>
        <h1>${escapeHtml(productTagline)}</h1>
        <p class="lede">${escapeHtml(productDescription)}</p>
        <div class="home-cta">
          <a class="btn btn-primary" href="loading.html">Get started</a>
          <a class="btn btn-ghost" href="${repoBase}" rel="noopener">GitHub</a>
          <div class="home-install" aria-label="Install with npm">
            <span class="prompt" aria-hidden="true">$</span>
            <code>${escapeHtml(installCommand)}</code>
          </div>
        </div>
        <div class="home-services" aria-label="Feature areas">
          ${featurePills.map((pill) => `<span>${escapeHtml(pill)}</span>`).join("")}
        </div>
      </header>`;
}

function standardHero(page, sectionName) {
  return `<header class="hero">
        <div class="hero-text">
          <p class="eyebrow">${escapeHtml(sectionName)}</p>
          <h1>${escapeHtml(page.title)}</h1>
        </div>
        <div class="hero-meta">
          <a class="repo-link" href="${repoBase}" rel="noopener">GitHub</a>
          <a class="repo-link muted-link" href="${repoEditBase}/${page.rel}" rel="noopener">Edit page</a>
        </div>
      </header>`;
}

function navHtml(activeRel) {
  return navSections
    .map(([name, rels]) => {
      const links = rels
        .map((rel) => {
          const page = pageMap.get(rel);
          const active = rel === activeRel ? " aria-current=\"page\"" : "";
          return `<a class="nav-link" href="${page.outRel}" data-title="${escapeHtml(page.title.toLowerCase())}"${active}>${escapeHtml(page.title)}</a>`;
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
const mobileNav = window.matchMedia("(max-width: 900px)");

function setSidebarOpen(open) {
  if (!sidebar || !menu) return;
  sidebar.classList.toggle("is-open", open);
  menu.setAttribute("aria-expanded", String(open));
  if (mobileNav.matches) {
    sidebar.inert = !open;
    sidebar.setAttribute("aria-hidden", open ? "false" : "true");
  } else {
    sidebar.inert = false;
    sidebar.removeAttribute("aria-hidden");
  }
}

setSidebarOpen(false);
menu?.addEventListener("click", () => setSidebarOpen(!sidebar?.classList.contains("is-open")));
document.addEventListener("click", (event) => {
  if (!sidebar?.classList.contains("is-open")) return;
  if (sidebar.contains(event.target) || menu?.contains(event.target)) return;
  setSidebarOpen(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setSidebarOpen(false);
});
mobileNav.addEventListener?.("change", () => setSidebarOpen(sidebar?.classList.contains("is-open") ?? false));

document.querySelector("#theme-toggle")?.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("theme", next);
});

document.querySelector("#nav-search")?.addEventListener("input", (event) => {
  const query = event.currentTarget.value.trim().toLowerCase();
  document.querySelectorAll("nav section").forEach((section) => {
    let visible = false;
    section.querySelectorAll("a[data-title]").forEach((link) => {
      const match = query.length === 0 || link.dataset.title.includes(query);
      link.hidden = !match;
      visible = visible || match;
    });
    section.hidden = !visible;
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
  --ink: #12151b;
  --text: #2a303a;
  --muted: #667181;
  --subtle: #98a2b3;
  --bg: #fbfcfd;
  --paper: #ffffff;
  --panel-soft: #f1f5f8;
  --line: #e2e8ef;
  --line-soft: #edf2f6;
  --accent: #d94135;
  --accent-soft: rgba(217, 65, 53, 0.1);
  --accent-strong: #b82f25;
  --teal: #087f8c;
  --teal-soft: rgba(8, 127, 140, 0.11);
  --code-bg: #0f1724;
  --code-text: #eef6ff;
  --shadow: 0 4px 16px rgba(18, 21, 27, 0.08);
  --shadow-strong: 0 18px 42px rgba(18, 21, 27, 0.12);
}

:root[data-theme="dark"] {
  color-scheme: dark;
  --ink: #f4f7fb;
  --text: #cbd4df;
  --muted: #94a0b1;
  --subtle: #667085;
  --bg: #0c1017;
  --paper: #151b25;
  --panel-soft: #1d2531;
  --line: #273241;
  --line-soft: #202936;
  --accent: #ff6b5f;
  --accent-soft: rgba(255, 107, 95, 0.16);
  --accent-strong: #ff867d;
  --teal: #36bfca;
  --teal-soft: rgba(54, 191, 202, 0.14);
  --code-bg: #070b12;
  --code-text: #eef6ff;
  --shadow: 0 4px 18px rgba(0, 0, 0, 0.38);
  --shadow-strong: 0 18px 42px rgba(0, 0, 0, 0.42);
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; scroll-padding-top: 24px; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 16px/1.65 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  overflow-x: hidden;
  -webkit-font-smoothing: antialiased;
}
a { color: var(--teal); text-decoration-thickness: 0.08em; text-underline-offset: 0.18em; }
a:hover { color: var(--accent); }
.skip-link {
  position: fixed;
  left: 1rem;
  top: 1rem;
  z-index: 20;
  transform: translateY(-180%);
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--paper);
  padding: 0.55rem 0.8rem;
  color: var(--ink);
  text-decoration: none;
  box-shadow: var(--shadow);
}
.skip-link:focus { transform: translateY(0); }
.shell { display: grid; grid-template-columns: 268px minmax(0, 1fr); min-height: 100vh; }
.sidebar {
  position: sticky;
  top: 0;
  height: 100vh;
  overflow: auto;
  border-right: 1px solid var(--line);
  background: var(--paper);
  padding: 24px 22px;
  scrollbar-width: thin;
  scrollbar-color: var(--line) transparent;
}
.sidebar-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 24px;
}
.brand {
  display: flex;
  flex: 1;
  min-width: 0;
  gap: 11px;
  align-items: center;
  color: var(--ink);
  text-decoration: none;
}
.brand:hover { text-decoration: none; }
.brand .mark { display: block; flex: 0 0 34px; width: 34px; height: 34px; }
.brand .mark svg { display: block; width: 34px; height: 34px; }
.brand strong { display: block; color: var(--ink); font-size: 1.04rem; line-height: 1.1; font-weight: 700; letter-spacing: 0; }
.brand small { display: block; color: var(--muted); font-size: 0.74rem; margin-top: 3px; line-height: 1.2; }
.theme-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--paper);
  color: var(--muted);
  cursor: pointer;
}
.theme-toggle:hover { border-color: var(--ink); color: var(--ink); }
.theme-icon {
  display: block;
  width: 17px;
  height: 17px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.theme-icon-sun { display: none; }
:root[data-theme="dark"] .theme-icon-sun { display: block; }
:root[data-theme="dark"] .theme-icon-moon { display: none; }
.search { display: block; margin-bottom: 22px; color: var(--muted); font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0; }
.search input {
  width: 100%;
  margin-top: 7px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--paper);
  color: var(--text);
  outline: none;
  padding: 9px 12px;
  font: inherit;
  font-size: 0.9rem;
}
.search input:focus { border-color: var(--teal); box-shadow: 0 0 0 3px var(--teal-soft); }
nav section { margin: 0 0 18px; }
nav h2 {
  margin: 0 0 6px;
  color: var(--muted);
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0;
}
.nav-link {
  display: block;
  padding: 5px 10px;
  margin: 1px 0;
  border-radius: 6px;
  color: var(--text);
  text-decoration: none;
  font-size: 0.9rem;
  font-weight: 520;
  line-height: 1.4;
}
.nav-link:hover { background: var(--line-soft); color: var(--ink); text-decoration: none; }
.nav-link[aria-current="page"] { background: var(--teal-soft); color: var(--teal); font-weight: 700; }
.nav-toggle {
  display: none;
  position: fixed;
  top: 14px;
  right: 14px;
  z-index: 20;
  width: 40px;
  height: 40px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: var(--paper);
  color: var(--ink);
  box-shadow: var(--shadow);
  cursor: pointer;
  padding: 10px 9px;
  flex-direction: column;
  align-items: stretch;
  justify-content: space-between;
}
.nav-toggle span { display: block; height: 2px; background: currentColor; border-radius: 2px; }
.nav-toggle[aria-expanded="true"] span:nth-child(1) { transform: translateY(8px) rotate(45deg); }
.nav-toggle[aria-expanded="true"] span:nth-child(2) { opacity: 0; }
.nav-toggle[aria-expanded="true"] span:nth-child(3) { transform: translateY(-8px) rotate(-45deg); }
main {
  min-width: 0;
  width: 100%;
  max-width: 1180px;
  margin: 0 auto;
  padding: 32px 56px 80px;
  outline: none;
}
.hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 22px;
  border-bottom: 1px solid var(--line);
  padding: 8px 0 22px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.hero-text { min-width: 0; flex: 1 1 320px; }
.eyebrow {
  margin: 0 0 8px;
  color: var(--muted);
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0;
}
.hero h1 {
  margin: 0;
  color: var(--ink);
  font-size: 2.25rem;
  line-height: 1.1;
  font-weight: 750;
  letter-spacing: 0;
}
.hero-meta { display: flex; gap: 8px; flex-wrap: wrap; }
.repo-link,
.btn {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--paper);
  color: var(--text);
  text-decoration: none;
  font-size: 0.86rem;
  font-weight: 650;
  padding: 7px 12px;
}
.repo-link:hover,
.btn:hover { border-color: var(--ink); color: var(--ink); text-decoration: none; }
.muted-link { color: var(--muted); }
.home-hero {
  border-bottom: 1px solid var(--line);
  padding: 14px 0 28px;
  margin-bottom: 8px;
}
.home-hero h1 {
  margin: 0 0 0.35em;
  color: var(--ink);
  font-size: 3.25rem;
  line-height: 1.04;
  font-weight: 760;
  letter-spacing: 0;
}
.home-hero .lede {
  max-width: 60ch;
  margin: 0 0 1.2em;
  color: var(--text);
  font-size: 1.18rem;
  line-height: 1.55;
}
.home-cta { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 18px; }
.btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.btn-primary:hover { background: var(--accent-strong); border-color: var(--accent-strong); color: #fff; }
.home-install {
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: 32em;
  border: 1px solid #1f2937;
  border-radius: 8px;
  background: var(--code-bg);
  color: var(--code-text);
  padding: 10px 16px;
  font: 500 0.9rem/1.2 "SF Mono", ui-monospace, Menlo, Consolas, monospace;
}
.home-install .prompt { color: #64748b; user-select: none; }
.home-install code {
  border: 0;
  background: transparent;
  color: inherit;
  padding: 0;
  font: inherit;
  white-space: pre;
}
.home-services { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.home-services span {
  display: inline-block;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--paper);
  color: var(--muted);
  padding: 3px 9px;
  font-size: 0.78rem;
}
.doc-grid {
  display: grid;
  grid-template-columns: minmax(0, 72ch) 200px;
  justify-content: start;
  gap: 48px;
  margin-top: 24px;
}
.doc-grid-home { grid-template-columns: minmax(0, 76ch); margin-top: 8px; }
.doc {
  min-width: 0;
  max-width: 72ch;
  overflow-wrap: anywhere;
}
.doc-home { max-width: 76ch; }
.doc > h1:first-child,
.home .doc > h1:first-child { display: none; }
.doc h1 {
  margin: 0 0 0.4em;
  color: var(--ink);
  font-size: 2.6rem;
  line-height: 1.08;
  font-weight: 760;
  letter-spacing: 0;
}
.doc h2 { margin: 2em 0 0.5em; color: var(--ink); font-size: 1.45rem; line-height: 1.2; font-weight: 700; letter-spacing: 0; position: relative; }
.doc h3 { margin: 1.7em 0 0.35em; color: var(--ink); font-size: 1.1rem; font-weight: 700; letter-spacing: 0; position: relative; }
.doc h4 { margin: 1.4em 0 0.25em; color: var(--ink); font-size: 0.98rem; font-weight: 700; letter-spacing: 0; position: relative; }
.doc h2:first-child,
.doc h3:first-child,
.doc h4:first-child { margin-top: 0.2em; }
.doc p { margin: 0 0 1.05em; }
.doc ul,
.doc ol { margin: 0 0 1.15em; padding-left: 1.3rem; }
.doc li { margin: 0.25em 0; }
.doc strong { color: var(--ink); font-weight: 700; }
.doc blockquote {
  margin: 1.4em 0;
  border-left: 3px solid var(--teal);
  border-radius: 0 8px 8px 0;
  background: var(--teal-soft);
  color: var(--muted);
  padding: 10px 16px;
}
.doc code {
  border: 1px solid var(--line);
  border-radius: 5px;
  background: var(--line-soft);
  color: var(--ink);
  padding: 0.08rem 0.28rem;
  font: 0.86em "SF Mono", ui-monospace, Menlo, Consolas, monospace;
}
.code-wrap {
  position: relative;
  margin: 1.3em 0;
  border-radius: 8px;
  background: var(--code-bg);
  color: var(--code-text);
  overflow: hidden;
  border: 1px solid #1f2937;
}
.code-wrap > span {
  position: absolute;
  left: 0.85rem;
  top: 0.62rem;
  color: #9fb0c3;
  font-size: 0.74rem;
  font-weight: 700;
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
.doc pre {
  margin: 0;
  padding: 2.7rem 1rem 1rem;
  overflow-x: auto;
  line-height: 1.5;
  max-width: 100%;
  min-width: 0;
}
.doc pre code {
  border: 0;
  background: transparent;
  color: inherit;
  padding: 0;
  font-size: 1em;
}
.anchor {
  position: absolute;
  left: -1.05em;
  margin-left: 0;
  padding-right: 0.35em;
  opacity: 0;
  text-decoration: none;
}
h2:hover .anchor,
h3:hover .anchor,
h4:hover .anchor { opacity: 0.75; }
.toc {
  position: sticky;
  top: 24px;
  align-self: start;
  color: var(--muted);
  font-size: 0.84rem;
  border-left: 1px solid var(--line);
  padding-left: 14px;
  max-height: calc(100vh - 48px);
  overflow: auto;
}
.toc-title { color: var(--muted); font-size: 0.66rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0; margin-bottom: 10px; }
.toc ol { list-style: none; padding: 0; margin: 0; }
.toc li { margin: 0; }
.toc-l3 { padding-left: 22px; }
.toc a { display: block; color: var(--muted); text-decoration: none; padding: 4px 0 4px 10px; line-height: 1.35; border-left: 2px solid transparent; margin-left: -12px; }
.toc a:hover { color: var(--ink); }
.pager {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-top: 48px;
  padding-top: 20px;
  border-top: 1px solid var(--line);
}
.pager a {
  display: block;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: var(--paper);
  padding: 13px 16px;
  color: var(--text);
  text-decoration: none;
  font-weight: 700;
}
.pager a:hover {
  border-color: var(--teal);
  color: var(--ink);
}
.pager a:last-child { text-align: right; }
.pager span { display: block; color: var(--muted); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0; margin-bottom: 5px; }

@media (max-width: 1179px) {
  .doc-grid { grid-template-columns: minmax(0, 1fr); gap: 24px; }
  .toc { display: none; }
}

@media (max-width: 900px) {
  .shell { display: block; }
  .sidebar {
    position: fixed;
    inset: 0 30% 0 0;
    z-index: 15;
    height: 100vh;
    max-width: 320px;
    transform: translateX(-100%);
    transition: transform 180ms ease;
    box-shadow: var(--shadow-strong);
    pointer-events: none;
  }
  .sidebar.is-open { transform: translateX(0); pointer-events: auto; }
  .nav-toggle { display: flex; }
  main { padding: 64px 18px 56px; }
  .hero { padding-top: 6px; }
  .hero h1 { font-size: 1.8rem; }
  .home-hero h1 { font-size: 2.45rem; }
  .doc h1 { font-size: 2.1rem; }
  .hero-meta { width: 100%; justify-content: flex-start; }
  .doc-grid { margin-top: 18px; }
  .anchor { display: none; }
}

@media (max-width: 520px) {
  main { padding: 60px 14px 48px; }
  .home-install { width: 100%; overflow-x: auto; }
  .code-wrap { margin-left: -14px; margin-right: -14px; border-radius: 0; border-left: 0; border-right: 0; }
  .pager { grid-template-columns: 1fr; }
  .pager a:last-child { text-align: left; }
}
`;
}
