import { type ExtractResult } from "../extract.js";

export type MessageContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: {
        type: "base64";
        media_type: "image/png";
        data: string;
      };
    };

export function toMessageContent(result: ExtractResult): MessageContentBlock[] {
  const blocks: MessageContentBlock[] = [];
  if (result.text) {
    blocks.push({ type: "text", text: result.text });
  }
  for (const image of result.images) {
    blocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: image.mimeType,
        data: bytesToBase64(image.bytes),
      },
    });
  }
  return blocks;
}

export function toDataUrls(result: ExtractResult): string[] {
  return result.images.map((image) => `data:${image.mimeType};base64,${bytesToBase64(image.bytes)}`);
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
