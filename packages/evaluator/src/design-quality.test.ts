import { describe, expect, it } from "vitest";
import {
  __INTERNAL_DESIGN_QUALITY,
  evaluateDesignQuality,
  type RenderedNodeLike,
} from "./design-quality.js";
import type { D2CSourceMap } from "@d2c/contracts";

const sourceMap: D2CSourceMap = {
  version: "1.0",
  locators: [
    { nodeId: "title", file: "src/pages/campaign/CampaignPage.tsx", styleFile: "src/pages/campaign/CampaignPage.module.css", styleSelector: ".title" },
    { nodeId: "icon", file: "src/pages/campaign/CampaignPage.tsx", styleFile: "src/pages/campaign/CampaignPage.module.css", styleSelector: ".icon" },
  ],
};

function makeNode(overrides: Partial<RenderedNodeLike>): RenderedNodeLike {
  return {
    x: 0,
    y: 0,
    width: 200,
    height: 40,
    visible: true,
    overflowX: "visible",
    overflowY: "visible",
    position: "relative",
    zIndex: "auto",
    color: "rgb(0, 0, 0)",
    backgroundColor: "rgb(255, 255, 255)",
    fontFamily: "Arial",
    fontSize: "16px",
    lineHeight: "normal",
    ...overrides,
  };
}

describe("design-quality 工具函数", () => {
  it("parseFontSizePx 支持 px/rem/em 三种单位", () => {
    expect(__INTERNAL_DESIGN_QUALITY.parseFontSizePx("16px")).toBe(16);
    expect(__INTERNAL_DESIGN_QUALITY.parseFontSizePx("1rem")).toBe(16);
    expect(__INTERNAL_DESIGN_QUALITY.parseFontSizePx("1.5em")).toBe(24);
    expect(__INTERNAL_DESIGN_QUALITY.parseFontSizePx("")).toBeNull();
    expect(__INTERNAL_DESIGN_QUALITY.parseFontSizePx(undefined)).toBeNull();
    expect(__INTERNAL_DESIGN_QUALITY.parseFontSizePx("invalid")).toBeNull();
  });

  it("parseRgb 仅匹配 rgb()/rgba() 前三通道，缺字段返回 null", () => {
    expect(__INTERNAL_DESIGN_QUALITY.parseRgb("rgb(0, 0, 0)")).toEqual({ r: 0, g: 0, b: 0 });
    expect(__INTERNAL_DESIGN_QUALITY.parseRgb("rgba(255, 128, 64, 0.5)")).toEqual({ r: 255, g: 128, b: 64 });
    expect(__INTERNAL_DESIGN_QUALITY.parseRgb("red")).toBeNull();
    expect(__INTERNAL_DESIGN_QUALITY.parseRgb("")).toBeNull();
  });

  it("contrastRatio 计算符合 WCAG 2.x 公式：黑 vs 白 ≈ 21:1", () => {
    // 已知：黑 (0,0,0) vs 白 (255,255,255) 对比度 21:1
    expect(__INTERNAL_DESIGN_QUALITY.contrastRatio("rgb(0, 0, 0)", "rgb(255, 255, 255)")).toBeCloseTo(21, 0);
    // 浅灰文字 vs 白底 ≈ 1.6
    const lowContrast = __INTERNAL_DESIGN_QUALITY.contrastRatio("rgb(200, 200, 200)", "rgb(255, 255, 255)")!;
    expect(lowContrast).toBeLessThan(4.5);
    // 顺序无关：fg/bg 互换结果相同
    const reversed = __INTERNAL_DESIGN_QUALITY.contrastRatio("rgb(255, 255, 255)", "rgb(0, 0, 0)")!;
    expect(reversed).toBeCloseTo(21, 0);
  });

  it("contrastRatio 在 rgb 解析失败时返回 null 而非抛错", () => {
    expect(__INTERNAL_DESIGN_QUALITY.contrastRatio("not-a-color", "rgb(255, 255, 255)")).toBeNull();
    expect(__INTERNAL_DESIGN_QUALITY.contrastRatio(undefined, "rgb(0, 0, 0)")).toBeNull();
  });

  it("isTextLikeNode 区分文本 vs 装饰像素", () => {
    expect(__INTERNAL_DESIGN_QUALITY.isTextLikeNode(makeNode({ fontSize: "16px" }))).toBe(true);
    expect(__INTERNAL_DESIGN_QUALITY.isTextLikeNode(makeNode({ fontSize: "12px" }))).toBe(true);
    expect(__INTERNAL_DESIGN_QUALITY.isTextLikeNode(makeNode({ fontSize: "10px" }))).toBe(true);
    expect(__INTERNAL_DESIGN_QUALITY.isTextLikeNode(makeNode({ fontSize: "7px" }))).toBe(false);
    expect(__INTERNAL_DESIGN_QUALITY.isTextLikeNode(makeNode({ fontSize: "" }))).toBe(false);
    expect(__INTERNAL_DESIGN_QUALITY.isTextLikeNode(makeNode({ visible: false }))).toBe(false);
  });

  it("isTinyComponentCandidate 仅命中无 fontSize 的小尺寸节点", () => {
    expect(__INTERNAL_DESIGN_QUALITY.isTinyComponentCandidate(makeNode({ fontSize: "", width: 24, height: 24 }))).toBe(true);
    expect(__INTERNAL_DESIGN_QUALITY.isTinyComponentCandidate(makeNode({ fontSize: "", width: 200, height: 40 }))).toBe(false);
    expect(__INTERNAL_DESIGN_QUALITY.isTinyComponentCandidate(makeNode({ fontSize: "16px", width: 24, height: 24 }))).toBe(false);
  });
});

describe("evaluateDesignQuality 评分", () => {
  it("全合规场景返回 score=100 且无 violation", () => {
    const report = evaluateDesignQuality({
      renderedNodes: { title: makeNode({}) },
      sourceMap,
    });
    expect(report.score).toBe(100);
    expect(report.violations).toHaveLength(0);
  });

  it("无可评估节点（全装饰）时返回 score=null 而非冒充分数", () => {
    const report = evaluateDesignQuality({
      renderedNodes: { banner: makeNode({ fontSize: "", width: 390, height: 800 }) },
      sourceMap,
    });
    expect(report.score).toBeNull();
    expect(report.violations).toHaveLength(0);
  });

  it("扣分制：单个 P0 字号违规扣 10 分（100→90）", () => {
    const report = evaluateDesignQuality({
      renderedNodes: { title: makeNode({ fontSize: "10px" }) },
      sourceMap,
    });
    expect(report.score).toBe(90);
    expect(report.violations[0]?.id).toBe("design:font-size:title");
    expect(report.violations[0]?.severity).toBe("P0");
  });

  it("多个违规累计扣分；总扣分超 100 时归零", () => {
    // 10 个 P0 + 若干 P1 → 必然扣到 0
    const nodes: Record<string, RenderedNodeLike> = {};
    for (let i = 0; i < 20; i += 1) {
      nodes[`t${i}`] = makeNode({ fontSize: "8px", color: "rgb(200, 200, 200)" });
    }
    const report = evaluateDesignQuality({ renderedNodes: nodes, sourceMap });
    expect(report.score).toBe(0);
    expect(report.violations.length).toBeGreaterThanOrEqual(20);
  });
});

describe("evaluateDesignQuality 来源定位", () => {
  it("violation 通过 sourceMap 携带节点文件定位，便于编辑器跳转", () => {
    const report = evaluateDesignQuality({
      renderedNodes: { title: makeNode({ fontSize: "10px" }) },
      sourceMap,
    });
    const locator = report.violations[0]?.sourceLocators[0];
    expect(locator?.file).toBe("src/pages/campaign/CampaignPage.tsx");
    expect(locator?.styleFile).toBe("src/pages/campaign/CampaignPage.module.css");
  });
});