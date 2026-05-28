const pngSignature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const crcTable = makeCrcTable();

export function encodePngRgba(width: number, height: number, rgba: Uint8Array): Uint8Array {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new RangeError("PNG dimensions must be positive integers");
  }
  if (rgba.byteLength !== width * height * 4) {
    throw new RangeError(`RGBA buffer has ${rgba.byteLength} bytes; expected ${width * height * 4}`);
  }

  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const rawOffset = row * (stride + 1);
    raw[rawOffset] = 0;
    raw.set(rgba.subarray(row * stride, (row + 1) * stride), rawOffset + 1);
  }

  return concat([
    pngSignature,
    chunk("IHDR", ihdr(width, height)),
    chunk("IDAT", zlibStore(raw)),
    chunk("IEND", new Uint8Array()),
  ]);
}

function ihdr(width: number, height: number): Uint8Array {
  const out = new Uint8Array(13);
  const view = new DataView(out.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  out[8] = 8;
  out[9] = 6;
  return out;
}

function zlibStore(input: Uint8Array): Uint8Array {
  const blocks: Uint8Array[] = [Uint8Array.from([0x78, 0x01])];
  for (let offset = 0; offset < input.byteLength; offset += 65_535) {
    const part = input.subarray(offset, Math.min(input.byteLength, offset + 65_535));
    const header = new Uint8Array(5);
    header[0] = offset + part.byteLength >= input.byteLength ? 1 : 0;
    header[1] = part.byteLength & 0xff;
    header[2] = (part.byteLength >>> 8) & 0xff;
    const nlen = (~part.byteLength) & 0xffff;
    header[3] = nlen & 0xff;
    header[4] = (nlen >>> 8) & 0xff;
    blocks.push(header, part);
  }
  const trailer = new Uint8Array(4);
  new DataView(trailer.buffer).setUint32(0, adler32(input));
  blocks.push(trailer);
  return concat(blocks);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.byteLength);
  const typeBytes = new TextEncoder().encode(type);
  out.set(typeBytes, 4);
  out.set(data, 8);
  view.setUint32(8 + data.byteLength, crc32(out.subarray(4, 8 + data.byteLength)));
  return out;
}

function adler32(input: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of input) {
    a = (a + byte) % 65_521;
    b = (b + a) % 65_521;
  }
  return ((b << 16) | a) >>> 0;
}

function crc32(input: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}
