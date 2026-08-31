import type { FigmaImportBundle } from "@d2c/figma-patcher";
import { describe, expect, it } from "vitest";
import { importBundle, type FigmaFacade, type FigmaFacadeNode } from "./import";

describe("real Figma runtime compatibility", () => {
  it("uses resize, replaces immutable paints, normalizes colors and loads fonts before text edits", async () => {
    const nodes: FigmaFacadeNode[] = [];
    const loaded = new Set<string>();
    const makeNode = (type: FigmaFacadeNode["type"]): FigmaFacadeNode => {
      let width = 0;
      let height = 0;
      let fills: FigmaFacadeNode["fills"] = Object.freeze([]) as unknown as FigmaFacadeNode["fills"];
      let characters = "";
      const node = { id: `node-${nodes.length}`, type, name: "", x: 0, y: 0, pluginData: {} } as FigmaFacadeNode;
      Object.defineProperties(node, {
        width: { get: () => width, set: () => { throw new Error("width is read-only; call resize"); } },
        height: { get: () => height, set: () => { throw new Error("height is read-only; call resize"); } },
        fills: { get: () => fills, set: (value) => { fills = Object.freeze([...value]) as unknown as FigmaFacadeNode["fills"]; } },
        characters: { get: () => characters, set: (value: string) => { if (![...loaded].some((font) => font.startsWith("Noto Sans SC:"))) throw new Error("font not loaded"); characters = value; } },
      });
      node.resize = (nextWidth, nextHeight) => { width = nextWidth; height = nextHeight; };
      nodes.push(node);
      return node;
    };
    const facade: FigmaFacade = {
      createFrame: () => makeNode("FRAME"), createText: () => makeNode("TEXT"), createRectangle: () => makeNode("RECTANGLE"),
      createImage: () => ({ hash: "image" }), decodeBase64: () => new Uint8Array(), appendChild: () => undefined,
      setPluginData: (node, key, value) => { node.pluginData[key] = value; },
      loadFontAsync: async (family, style) => { loaded.add(`${family}:${style}`); },
    };
    const bundle: FigmaImportBundle = {
      version: "2.0", viewport: { width: 390, height: 823 }, assets: [{ id: "reference", mimeType: "image/jpeg", data: "AQID" }], degradations: [], manifest: { name: "原型", route: "/prototype", referenceAssetId: "reference" },
      nodes: [{
        type: "FRAME", id: "root", name: "根", x: 0, y: 0, width: 390, height: 823,
        fills: [{ type: "SOLID", color: { r: 16, g: 13, b: 53 } }], layout: { mode: "absolute", rationale: "根" }, pluginData: { d2cNodeId: "root" },
        children: [{
          type: "TEXT", id: "action", name: "按钮文字", x: 280, y: 260, width: 80, height: 34, characters: "去完成", fontFamily: "Noto Sans SC", fontSize: 13, fontWeight: 700,
          fills: [{ type: "GRADIENT_LINEAR", gradientStops: [{ position: 0, color: { r: 244, g: 239, b: 255, a: 1 } }, { position: 1, color: { r: 217, g: 203, b: 255, a: 1 } }], gradientTransform: [[1, 0, 0], [0, 1, 0]] }],
          layout: { mode: "absolute", rationale: "按钮" }, pluginData: { d2cNodeId: "action" },
        }],
      }],
    };

    await importBundle(bundle, facade);

    expect(nodes[0]).toMatchObject({ width: 390, height: 823 });
    expect(nodes[0]!.fills[0]).toMatchObject({ type: "SOLID", color: { r: 16 / 255, g: 13 / 255, b: 53 / 255 } });
    expect(nodes[1]).toMatchObject({ width: 80, height: 34, characters: "去完成", fontName: { family: "Noto Sans SC", style: "Bold" } });
    expect(nodes[1]!.fills[0]).toMatchObject({ type: "GRADIENT_LINEAR" });
    expect(nodes[1]!.fills[0]!.gradientStops?.[0]).toMatchObject({ color: { r: 244 / 255, g: 239 / 255, b: 1, a: 1 } });
    expect(nodes[2]).toMatchObject({ name: "Reference（隐藏）", width: 390, height: 823, visible: false, locked: true });
  });
});
