import { activitySpecSchema } from "@d2c/contracts";
import { describe, expect, it } from "vitest";
import { buildActivitySpecDraft, type ActivitySpecDraftInput, type ActivitySpecVisionProvider } from "./vision-production";

const baseInput: ActivitySpecDraftInput = {
  name: "夏日好物节",
  route: "/campaign/summer",
  imageDataUrl: "data:image/png;base64,AAAA",
  canonicalViewport: { width: 1440, height: 900 },
  prdFacts: [{ nodeId: "hero-title", field: "text", value: "PRD 标题", source: "prd.md#L12" }],
};

const validDraft = {
  page: { name: "夏日好物节", route: "/campaign/summer" },
  nodes: [
    { id: "page", role: "page", name: "页面", box: { x: 0, y: 0, width: 1440, height: 900 }, layout: { mode: "flow", width: "fill", height: "hug" } },
    { id: "hero", parentId: "page", role: "section", name: "主视觉", box: { x: 0, y: 0, width: 1440, height: 500 }, layout: { mode: "flex", direction: "column", width: "fill", height: "fixed", heightValue: 500 } },
    { id: "hero-title", parentId: "hero", role: "text", name: "标题", box: { x: 40, y: 40, width: 600, height: 72 }, layout: { mode: "flow", width: "hug", height: "hug" }, text: "视觉识别标题", confidence: .8 },
  ],
};

const fakeProvider: ActivitySpecVisionProvider = async () => ({ ok: true, draft: structuredClone(validDraft) });

describe("buildActivitySpecDraft", () => {
  it("merges PRD facts above vision text and keeps model uncertainty", async () => {
    const result = await buildActivitySpecDraft(baseInput, fakeProvider);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.nodes.find((node) => node.id === "hero-title")?.content?.text).toBe("PRD 标题");
    expect(result.spec.unresolved).toContainEqual(expect.objectContaining({
      id: expect.any(String),
      nodeId: "hero-title",
      reason: expect.stringContaining("conflict"),
    }));
    expect(() => activitySpecSchema.parse(result.spec)).not.toThrow();
  });

  it("attaches ocr and asset evidence with pixel regions", async () => {
    const result = await buildActivitySpecDraft({
      ...baseInput,
      prdFacts: [],
      ocr: [{ text: "夏日好物节", region: { x: 40, y: 40, width: 600, height: 72 }, confidence: .9 }],
      assets: [{ id: "hero-art", path: "assets/hero.png", mimeType: "image/png", region: { x: 600, y: 0, width: 840, height: 500 } }],
    }, fakeProvider);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const title = result.spec.nodes.find((node) => node.id === "hero-title");
    expect(title?.evidence.some((item) => item.type === "ocr" && item.observation === "夏日好物节")).toBe(true);
    expect(result.spec.assets[0]?.id).toBe("hero-art");
    expect(result.spec.assets[0]?.evidence[0]?.type).toBe("asset");
  });

  it("retries once with schema feedback when the draft is invalid", async () => {
    let calls = 0;
    const provider: ActivitySpecVisionProvider = async (request) => {
      calls += 1;
      if (calls === 1) return { ok: true, draft: { nonsense: true } };
      expect(request.previousError).toBeTruthy();
      return { ok: true, draft: structuredClone(validDraft) };
    };
    const result = await buildActivitySpecDraft(baseInput, provider);
    expect(calls).toBe(2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.version).toBe("2.0");
  });

  it("fails with a typed error after the retry still produces an invalid spec", async () => {
    const result = await buildActivitySpecDraft(baseInput, async () => ({ ok: true, draft: { nonsense: true } }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("DRAFT_INVALID");
  });

  it("propagates provider failures", async () => {
    const result = await buildActivitySpecDraft(baseInput, async () => ({ ok: false, code: "VISION_UNAVAILABLE", message: "网络错误" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("VISION_UNAVAILABLE");
  });
});
