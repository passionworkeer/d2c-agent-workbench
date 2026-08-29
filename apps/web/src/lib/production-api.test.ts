import { activitySpecSchema, targetProjectProfileSchema } from "@d2c/contracts";
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
    const repos = new Set(GOLDEN_SAMPLES.map((sample) => sample.payload.profile.repositoryPath));
    expect(repos.size).toBe(1);
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
      expect(JSON.parse(fixture.profile), `${sample.id}: examples profile 与内嵌样例漂移`).toEqual(sample.payload.profile);
    }
  });

  it("keeps every sample valid against ActivitySpec v2 and the profile schema", () => {
    for (const sample of GOLDEN_SAMPLES) {
      expect(() => activitySpecSchema.parse(sample.payload.spec)).not.toThrow();
      expect(() => targetProjectProfileSchema.parse(sample.payload.profile)).not.toThrow();
      for (const [nodeId, rect] of Object.entries(sample.payload.referenceNodes ?? {})) {
        const node = sample.payload.spec.nodes.find((item) => item.id === nodeId);
        expect(node, `${sample.id}: referenceNodes 指向的节点必须存在`).toBeTruthy();
        expect(rect.width).toBeGreaterThan(0);
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
