import { describe, expect, it } from "vitest";
import { comparePixelImages } from "./visual-report";

describe("comparePixelImages", () => {
  const image = (pixels: number[]) => ({ width: 2, height: 2, data: new Uint8ClampedArray(pixels) });
  const base = [0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255];
  it("reports exact and clustered pixel differences", () => {
    expect(comparePixelImages(image(base), image(base), { minClusterPixels: 1 })).toMatchObject({ score: 100, differentPixels: 0, clusters: [] });
    const changed = [...base]; changed[4] = 30;
    expect(comparePixelImages(image(base), image(changed), { minClusterPixels: 1 })).toMatchObject({ score: 75, differentPixels: 1, clusters: [{ left: 1, top: 0, right: 1, bottom: 0, pixels: 1 }] });
  });
  it("rejects incompatible dimensions", () => expect(() => comparePixelImages(image(base), { width: 1, height: 1, data: new Uint8ClampedArray(4) })).toThrow("尺寸不一致"));
});
