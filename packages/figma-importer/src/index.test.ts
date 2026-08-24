import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { BundleError, parseFigmaBundle } from "./index";

function json(value: unknown): Uint8Array {
  return strToU8(JSON.stringify(value));
}

function validArchive(): Uint8Array {
  return zipSync({
    "manifest.json": json({
      protocolVersion: "1.0",
      name: "Product Grid",
      viewport: { width: 1440, height: 900 },
    }),
    "design.json": json({
      nodes: [
        {
          id: "1",
          name: "Root",
          type: "FRAME",
          width: 1440,
          height: 900,
          layoutMode: "VERTICAL",
          layoutSizingHorizontal: "FIXED",
          layoutSizingVertical: "FIXED",
          children: [],
        },
      ],
    }),
    "variables.json": json([]),
    "components.json": json([]),
    "preview/root.svg": strToU8("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>"),
  });
}

describe("parseFigmaBundle", () => {
  it("parses and validates a complete bundle", () => {
    const result = parseFigmaBundle(validArchive());

    expect(result.manifest.name).toBe("Product Grid");
    expect(result.nodes[0]?.layoutMode).toBe("VERTICAL");
    expect(result.previewUrl).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it("rejects archives with parent path segments", () => {
    const archive = zipSync({
      "../escape.txt": strToU8("unsafe"),
      "manifest.json": json({}),
    });

    expect(() => parseFigmaBundle(archive)).toThrow(BundleError);
    expect(() => parseFigmaBundle(archive)).toThrow("Unsafe archive path");
  });
});
