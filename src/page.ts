import { encodePngRgba, encodePngRgbaCompressed } from "./png.js";
import { type DocumentImpl } from "./document.js";
import { type RenderOptions } from "./render.js";

export interface PdfPage extends Disposable {
  readonly index: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: 0 | 90 | 180 | 270;
  text(): string;
  render(options?: RenderOptions): {
    width: number;
    height: number;
    rgba: Uint8Array;
  };
  png(options?: RenderOptions & { compress?: boolean }): Promise<Uint8Array>;
  pngSync(options?: RenderOptions): Uint8Array;
}

export class PageImpl implements PdfPage {
  constructor(
    private readonly document: DocumentImpl,
    readonly index: number,
  ) {}

  get width(): number {
    return this.document.withLoadedPage(this.index, (page) => this.document.engine.module._FPDF_GetPageWidth(page));
  }

  get height(): number {
    return this.document.withLoadedPage(this.index, (page) => this.document.engine.module._FPDF_GetPageHeight(page));
  }

  get rotation(): 0 | 90 | 180 | 270 {
    return this.document.withLoadedPage(this.index, (page) => {
      const rotation = this.document.engine.module._FPDFPage_GetRotation(page);
      return ((((rotation % 4) + 4) % 4) * 90) as 0 | 90 | 180 | 270;
    });
  }

  text(): string {
    return this.document.getPageText(this.index);
  }

  render(options: RenderOptions = {}): { width: number; height: number; rgba: Uint8Array } {
    return this.document.renderPage(this.index, options);
  }

  async png(options: RenderOptions & { compress?: boolean } = {}): Promise<Uint8Array> {
    if (options.compress === false) {
      return this.pngSync(options);
    }
    const rendered = this.render(options);
    return encodePngRgbaCompressed(rendered.width, rendered.height, rendered.rgba);
  }

  pngSync(options: RenderOptions = {}): Uint8Array {
    const rendered = this.render(options);
    return encodePngRgba(rendered.width, rendered.height, rendered.rgba);
  }

  [Symbol.dispose](): void {}
}
