import { describe, expect, it } from "vitest";
import { planImageRender } from "../src/render.js";

describe("planImageRender pixel rounding", () => {
  it("does not mark a US Letter page at 150 DPI as truncated", () => {
    const plan = planImageRender(612, 792, 150 / 72, 4_000_000, 10_000);
    expect(plan).toMatchObject({ width: 1275, height: 1650, capped: false });
  });

  it("still reports a real pixel budget cap", () => {
    const plan = planImageRender(612, 792, 150 / 72, 1_000, 10_000);
    expect(plan).not.toBeNull();
    expect(plan?.capped).toBe(true);
    expect(plan?.width).toBeLessThan(1275);
    expect(plan?.height).toBeLessThan(1650);
  });

  it("still reports a real dimension cap", () => {
    expect(planImageRender(612, 792, 150 / 72, 4_000_000, 1649)).toMatchObject({
      width: 1275,
      height: 1649,
      capped: true,
    });
  });

  it("does not snap genuine fractional pixels to an integer", () => {
    expect(planImageRender(100.0000005, 100, 1, 20_000, 100)).toMatchObject({
      width: 100,
      height: 100,
      capped: true,
    });
  });

  it("keeps the rounded budget boundary", () => {
    expect(planImageRender(101, 53, 0.5, 1_370, 10_000)).toMatchObject({
      width: 50,
      height: 27,
      capped: true,
    });
    expect(planImageRender(101, 53, 0.5, 1_377, 10_000)).toMatchObject({
      width: 51,
      height: 27,
      capped: false,
    });
  });
});
