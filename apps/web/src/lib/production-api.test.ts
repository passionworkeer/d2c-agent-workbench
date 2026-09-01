import { activitySpecSchema, assetCropSchema, type ActivitySpec } from "@d2c/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import campaignSpecJson from "../../../../examples/activity-pages/campaign/activity-spec.json?raw";
import campaignProfileJson from "../../../../examples/activity-pages/campaign/target-profile.json?raw";
import summerFormSpecJson from "../../../../examples/activity-pages/summer-form/activity-spec.json?raw";
import summerFormProfileJson from "../../../../examples/activity-pages/summer-form/target-profile.json?raw";
import commerceFeedSpecJson from "../../../../examples/activity-pages/commerce-feed/activity-spec.json?raw";
import commerceFeedProfileJson from "../../../../examples/activity-pages/commerce-feed/target-profile.json?raw";
import commerceFeedManifestJson from "../../../../examples/activity-pages/commerce-feed/assets/manifest.json?raw";
import gameFestivalSpecJson from "../../../../examples/activity-pages/summer-game-festival/activity-spec.json?raw";
import gameFestivalProfileJson from "../../../../examples/activity-pages/summer-game-festival/target-profile.json?raw";
import gameFestivalManifestJson from "../../../../examples/activity-pages/summer-game-festival/assets/manifest.json?raw";
import petRedPacketSpecJson from "../../../../examples/activity-pages/pet-red-packet/activity-spec.json?raw";
import petRedPacketProfileJson from "../../../../examples/activity-pages/pet-red-packet/target-profile.json?raw";
import petRedPacketManifestJson from "../../../../examples/activity-pages/pet-red-packet/assets/manifest.json?raw";
import { GOLDEN_SAMPLES, loadEmbeddedAssets } from "./production-api";

/** 三张真实移动活动页：spec / profile / 裁切清单以磁盘 fixture 为单一事实源 */
const REAL_PAGE_FIXTURES = ["commerce-feed", "summer-game-festival", "pet-red-packet"] as const;

const realFixtureSource: Record<(typeof REAL_PAGE_FIXTURES)[number], { spec: string; profile: string; manifest: string }> = {
  "commerce-feed": { spec: commerceFeedSpecJson, profile: commerceFeedProfileJson, manifest: commerceFeedManifestJson },
  "summer-game-festival": { spec: gameFestivalSpecJson, profile: gameFestivalProfileJson, manifest: gameFestivalManifestJson },
  "pet-red-packet": { spec: petRedPacketSpecJson, profile: petRedPacketProfileJson, manifest: petRedPacketManifestJson },
};

/** 根节点可信映射的期望组件对与素材图集 URL（与服务端 profiles.ts 注册表对齐） */
const REAL_PAGE_ROOT_MAPPINGS: Record<(typeof REAL_PAGE_FIXTURES)[number], { component: string; atlasUrl: string }> = {
  "commerce-feed": { component: "CommerceFeedExperience", atlasUrl: "/commerce-feed/reference.jpg" },
  "summer-game-festival": { component: "SummerGameFestivalExperience", atlasUrl: "/game-festival/reference.jpg" },
  "pet-red-packet": { component: "PetRedPacketExperience", atlasUrl: "/pet-red-packet/reference.jpg" },
};

describe("GOLDEN_SAMPLES", () => {
  it("ships at least two structurally distinct samples sharing one target repo", () => {
    expect(GOLDEN_SAMPLES.length).toBeGreaterThanOrEqual(2);
    const routes = new Set(GOLDEN_SAMPLES.map((sample) => sample.payload.spec.page.route));
    expect(routes.size).toBe(GOLDEN_SAMPLES.length);
    const repos = new Set(GOLDEN_SAMPLES.map((sample) => sample.targetRepository));
    expect(repos.size).toBe(1);
    expect(GOLDEN_SAMPLES.map((sample) => sample.payload.sampleId)).toEqual(GOLDEN_SAMPLES.map((sample) => sample.id));
  });

  it("keeps examples/ fixtures in sync with the inline runtime samples（单一事实源防漂移）", () => {
    const disk: Record<string, { spec: string; profile: string }> = {
      campaign: { spec: campaignSpecJson, profile: campaignProfileJson },
      "summer-form": { spec: summerFormSpecJson, profile: summerFormProfileJson },
    };
    for (const sample of GOLDEN_SAMPLES) {
      const fixture = disk[sample.id];
      if (!fixture) continue;
      expect(JSON.parse(fixture.spec), `${sample.id}: examples spec 与内嵌样例漂移`).toEqual(sample.payload.spec);
      expect(JSON.parse(fixture.profile).repositoryPath, `${sample.id}: examples profile 与注册目标仓库漂移`).toEqual(sample.targetRepository);
    }
  });

  it("keeps every sample valid against ActivitySpec v2 and the profile schema", () => {
    for (const sample of GOLDEN_SAMPLES) {
      expect(() => activitySpecSchema.parse(sample.payload.spec)).not.toThrow();
      for (const [nodeId, rect] of Object.entries(sample.payload.referenceNodes ?? {})) {
        const node = sample.payload.spec.nodes.find((item) => item.id === nodeId);
        expect(node, `${sample.id}: referenceNodes 指向的节点必须存在`).toBeTruthy();
        expect(rect).toEqual(node!.sourceBox);
      }
    }
  });

  it("keeps every fixed-width mobile descendant within its viewport", () => {
    for (const sample of GOLDEN_SAMPLES) {
      for (const node of sample.payload.spec.nodes) {
        if (node.layout.width.mode !== "fixed" || (node.layout.width.value ?? 0) <= 390) continue;
        expect(node.responsive.some((constraint) => constraint.viewport === "mobile" && constraint.rule === "resize" && typeof constraint.value === "number" && constraint.value <= 390), `${sample.id}/${node.id}: 固定宽度节点缺 mobile resize`).toBe(true);
      }
    }
  });

  it("gives every node evidence and a unique id (闭环可追溯的前提)", () => {
    for (const sample of GOLDEN_SAMPLES) {
      const ids = new Set<string>();
      for (const node of sample.payload.spec.nodes) {
        expect(ids.has(node.id), `${sample.id}: 节点 id 重复 ${node.id}`).toBe(false);
        ids.add(node.id);
        expect(node.evidence.length, `${sample.id}/${node.id}: 缺少证据`).toBeGreaterThan(0);
      }
    }
  });
});

describe("真实移动活动页黄金样例（三张截图混合重建）", () => {
  it("GOLDEN_SAMPLES 仅注册三个真实页面", () => {
    expect(GOLDEN_SAMPLES.map((sample) => sample.id)).toEqual([
      "commerce-feed",
      "summer-game-festival",
      "pet-red-packet",
    ]);
  });

  for (const fixtureId of REAL_PAGE_FIXTURES) {
    const source = realFixtureSource[fixtureId];

    it(`${fixtureId}: ActivitySpec v2 解析通过且节点 id 唯一`, () => {
      const spec = JSON.parse(source.spec);
      expect(() => activitySpecSchema.parse(spec)).not.toThrow();
      expect(spec.page.canonicalViewport.width).toBe(390);
      expect(new Set(spec.nodes.map((node: { id: string }) => node.id)).size).toBe(spec.nodes.length);
      for (const node of spec.nodes) {
        expect(node.evidence.length, `${fixtureId}/${node.id}: 缺少证据`).toBeGreaterThan(0);
      }
    });

    it(`${fixtureId}: 裁切清单全部在归一化界内且 nodeId 指向真实节点`, () => {
      const spec = JSON.parse(source.spec);
      const manifest = JSON.parse(source.manifest) as { assets: Array<{ id: string; nodeId: string; crop: unknown }> };
      expect(manifest.assets.length).toBeGreaterThan(0);
      const nodeIds = new Set(spec.nodes.map((node: { id: string }) => node.id));
      for (const asset of manifest.assets) {
        expect(() => assetCropSchema.parse(asset.crop), `${fixtureId}/${asset.id}: crop 越界`).not.toThrow();
        expect(nodeIds.has(asset.nodeId), `${fixtureId}/${asset.id}: nodeId 不存在于 spec`).toBe(true);
      }
    });

    it(`${fixtureId}: 每个 image 节点都引用裁切清单中的资产`, () => {
      const spec = JSON.parse(source.spec);
      const manifest = JSON.parse(source.manifest) as { assets: Array<{ id: string }> };
      const cropIds = new Set(manifest.assets.map((asset) => asset.id));
      for (const node of spec.nodes) {
        if (node.role !== "image") continue;
        expect(cropIds.has(node.content?.assetId), `${fixtureId}/${node.id}: image 节点未引用 manifest 资产`).toBe(true);
      }
    });

    it(`${fixtureId}: 内嵌样例与磁盘 fixture 单一事实源同步`, () => {
      const sample = GOLDEN_SAMPLES.find((item) => item.id === fixtureId);
      expect(sample, `${fixtureId}: 未注册进 GOLDEN_SAMPLES`).toBeTruthy();
      expect(JSON.parse(source.spec), `${fixtureId}: examples spec 与内嵌样例漂移`).toEqual(sample!.payload.spec);
      expect(JSON.parse(source.profile).repositoryPath, `${fixtureId}: profile 目标仓库漂移`).toBe(sample!.targetRepository);
    });

    it(`${fixtureId}: 携带根节点可信映射且与目标组件对齐（不携带服务端 sourceFile）`, () => {
      const expected = REAL_PAGE_ROOT_MAPPINGS[fixtureId]!;
      const sample = GOLDEN_SAMPLES.find((item) => item.id === fixtureId);
      const accepted = (sample!.payload.mappings ?? []).filter((mapping) => mapping.status === "accepted");
      expect(accepted, `${fixtureId}: 应恰好一条可信映射`).toHaveLength(1);
      const mapping = accepted[0]!;
      const spec = JSON.parse(source.spec) as ActivitySpec;
      const rootIds = spec.nodes.filter((node: { parentId?: string }) => !node.parentId).map((node: { id: string }) => node.id);
      expect(rootIds, `${fixtureId}: 根节点应为 page`).toEqual(["page"]);
      expect(mapping.nodeId).toBe("page");
      expect(mapping.codeComponent).toBe(expected.component);
      expect(mapping.importPath).toBe(`@/components/activity/${expected.component}`);
      expect(mapping.props.atlasUrl).toBe(expected.atlasUrl);
      expect(mapping.evidence.length).toBeGreaterThan(0);
      expect((mapping as Record<string, unknown>).sourceFile, `${fixtureId}: 客户端映射不得携带服务端专用字段`).toBeUndefined();
    });
  }
});

describe("loadEmbeddedAssets", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fetches the real-sample atlas and returns it as a self-contained base64 entry", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }) } as unknown as Response));
    vi.stubGlobal("fetch", fetchMock);
    const assets = await loadEmbeddedAssets("commerce-feed");
    expect(assets).toEqual([{ id: "reference", path: "reference.jpg", mimeType: "image/jpeg", data: "AQID" }]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("returns an empty table for semantic-only golden samples without fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await loadEmbeddedAssets("campaign")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces load failures so the workbench can disable the Figma export", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, blob: async () => new Blob() } as unknown as Response)));
    await expect(loadEmbeddedAssets("pet-red-packet")).rejects.toThrow(/404/);
  });
});
