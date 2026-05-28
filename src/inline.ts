export type InlineImageMode = "none" | "auto" | "kitty" | "iterm";
export type InlineImageProtocol = "none" | "kitty" | "iterm";

export type InlineImage = {
  data: Uint8Array;
  name: string;
  label?: string;
};

type Writable = {
  write(chunk: string | Uint8Array): unknown;
  isTTY?: boolean;
  columns?: number;
};

export function resolveInlineImageProtocol({
  mode,
  env,
  stdout,
}: {
  mode: InlineImageMode;
  env: Record<string, string | undefined>;
  stdout: Writable;
}): InlineImageProtocol {
  if (mode === "none") return "none";
  if (!stdout.isTTY) return "none";
  if (mode === "kitty" || mode === "iterm") return mode;

  const termProgram = (env.TERM_PROGRAM ?? "").toLowerCase();
  const term = (env.TERM ?? "").toLowerCase();
  const isWezTerm = termProgram.includes("wezterm") || Boolean(env.WEZTERM_EXECUTABLE);
  if (
    env.KITTY_WINDOW_ID ||
    term.includes("xterm-kitty") ||
    isWezTerm ||
    termProgram.includes("ghostty") ||
    termProgram.includes("konsole") ||
    env.KONSOLE_VERSION
  ) {
    return isWezTerm ? "iterm" : "kitty";
  }
  if (termProgram.includes("iterm") || env.ITERM_SESSION_ID) {
    return "iterm";
  }
  return "none";
}

export function renderInlineImages({
  images,
  mode,
  env,
  stdout,
}: {
  images: InlineImage[];
  mode: InlineImageMode;
  env: Record<string, string | undefined>;
  stdout: Writable;
}): { rendered: number; protocol: InlineImageProtocol } {
  const protocol = resolveInlineImageProtocol({ mode, env, stdout });
  if (protocol === "none") {
    return { rendered: 0, protocol };
  }

  let rendered = 0;
  let nextId = 1;
  for (const image of images) {
    if (image.label) {
      const label = safeTerminalText(image.label);
      if (label) {
        stdout.write(`${label}\n`);
      }
    }
    const size = pngSize(image.data);
    const { cols, rows } = inlineCellSize({
      width: size?.width ?? null,
      height: size?.height ?? null,
      termCols: terminalWidth(stdout, env),
    });
    if (protocol === "kitty") {
      writeKittyImage({ stdout, data: image.data, cols, rows, id: nextId });
      nextId += 1;
    } else {
      writeItermImage({ stdout, data: image.data, cols, rows, name: image.name });
    }
    stdout.write("\n".repeat(Math.max(1, rows)));
    stdout.write("\n");
    rendered += 1;
  }
  return { rendered, protocol };
}

function safeTerminalText(value: string): string {
  return value
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x1f\x7f-\x9f]/g, "");
}

function pngSize(data: Uint8Array): { width: number; height: number } | null {
  if (data.byteLength < 24) return null;
  if (
    data[0] !== 0x89 ||
    data[1] !== 0x50 ||
    data[2] !== 0x4e ||
    data[3] !== 0x47 ||
    data[4] !== 0x0d ||
    data[5] !== 0x0a ||
    data[6] !== 0x1a ||
    data[7] !== 0x0a
  ) {
    return null;
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

function inlineCellSize({
  width,
  height,
  termCols,
}: {
  width: number | null;
  height: number | null;
  termCols: number;
}): { cols: number; rows: number } {
  const maxCols = clampInt(24, 64, Math.floor(termCols * 0.75));
  const preferredCols = Math.floor(termCols * 0.6);
  const cols = clampInt(16, maxCols, preferredCols);
  if (!width || !height) {
    return { cols, rows: 10 };
  }
  const rows = clampInt(4, 24, Math.round(cols * 0.5 * (height / width)));
  return { cols, rows };
}

function terminalWidth(stdout: Writable, env: Record<string, string | undefined>): number {
  if (typeof stdout.columns === "number" && Number.isFinite(stdout.columns) && stdout.columns > 0) {
    return Math.floor(stdout.columns);
  }
  const columns = env.COLUMNS ? Number(env.COLUMNS) : NaN;
  return Number.isFinite(columns) && columns > 0 ? Math.floor(columns) : 80;
}

function clampInt(min: number, max: number, value: number): number {
  return Math.min(max, Math.max(min, value));
}

function writeKittyImage({
  stdout,
  data,
  cols,
  rows,
  id,
}: {
  stdout: Writable;
  data: Uint8Array;
  cols: number;
  rows: number;
  id: number;
}): void {
  const encoded = Buffer.from(data).toString("base64");
  const chunkSize = 4096;
  let offset = 0;
  let first = true;
  while (offset < encoded.length) {
    const chunk = encoded.slice(offset, offset + chunkSize);
    offset += chunkSize;
    const more = offset < encoded.length ? 1 : 0;
    if (first) {
      const params = [
        "a=T",
        "f=100",
        `i=${id}`,
        `m=${more}`,
        "q=2",
        `c=${cols}`,
        `r=${rows}`,
        "C=1",
      ].join(",");
      stdout.write(`\u001b_G${params};${chunk}\u001b\\`);
      first = false;
    } else {
      stdout.write(`\u001b_Gm=${more};${chunk}\u001b\\`);
    }
  }
}

function writeItermImage({
  stdout,
  data,
  cols,
  rows,
  name,
}: {
  stdout: Writable;
  data: Uint8Array;
  cols: number;
  rows: number;
  name: string;
}): void {
  const encodedName = Buffer.from(name).toString("base64");
  const encodedData = Buffer.from(data).toString("base64");
  const args = [
    `name=${encodedName}`,
    `size=${data.byteLength}`,
    "inline=1",
    "preserveAspectRatio=1",
    `width=${cols}`,
    `height=${rows}`,
  ].join(";");
  stdout.write(`\u001b]1337;File=${args}:${encodedData}\u001b\\`);
}
