import { activitySpecSchema } from "@d2c/contracts";
import { describe, expect, it } from "vitest";
import campaignSpecJson from "../../../../examples/activity-pages/campaign/activity-spec.json?raw";
import campaignProfileJson from "../../../../examples/activity-pages/campaign/target-profile.json?raw";
import summerFormSpecJson from "../../../../examples/activity-pages/summer-form/activity-spec.json?raw";
import summerFormProfileJson from "../../../../examples/activity-pages/summer-form/target-profile.json?raw";
import { GOLDEN_SAMPLES } from "./production-api";

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
        expect(rect.width).toBeGreaterThan(0);
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
