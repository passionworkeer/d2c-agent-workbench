import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { patchPlanSchema, type PatchPlan, type ProductionViolation, type TargetProjectProfile } from "@d2c/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { FileArtifactStore, RunWorkspace, applyPatchPlan, planTargetedRepair, shouldContinueRepair, validatePatchPlan } from "./index";

const buildPlan = (value: unknown) => patchPlanSchema.parse(value) as PatchPlan;

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

const profile: TargetProjectProfile = {
  repositoryPath: "target", framework: "react", language: "typescript", packageManager: "pnpm",
  routeEntry: "src/App.tsx", generatedRoot: "src/pages/campaign", assetRoot: "public/campaign", styleStrategy: "css-modules",
  commands: { typecheck: ["pnpm", "typecheck"], build: ["pnpm", "build"], dev: ["pnpm", "dev"] },
  previewUrl: "http://127.0.0.1:4173", allowedWriteGlobs: ["src/pages/campaign/**", "public/campaign/**"],
  designSystemRoots: ["src/components"], tokenRoots: [],
};

const sourceMap = {
  version: "1.0" as const,
  locators: [
    { nodeId: "hero", file: "src/pages/campaign/CampaignPage.tsx", styleFile: "src/pages/campaign/CampaignPage.module.css", styleSelector: ".hero" },
  ],
};

const layoutViolation: ProductionViolation = {
  id: "layout:hero", severity: "P1", type: "layout", nodeIds: ["hero"], sourceLocators: sourceMap.locators,
  expected: { x: 0, y: 0, width: 1000, height: 500 }, actual: { x: 12, y: 0, width: 988, height: 500 },
  evidence: [], confidence: .95, suggestedAction: "修正父容器布局、间距或尺寸约束",
};

async function createWorkspace(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "d2c-repair-"));
  roots.push(root);
  const workspace = await RunWorkspace.create(join(root, "workspace"), profile);
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(workspace.root, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, content, "utf8");
  }
  return workspace;
}

describe("validatePatchPlan", () => {
  it("rejects patches touching undeclared files", () => {
    const plan = buildPlan({
      round: 1, targetViolationIds: ["layout:hero"], expectedImprovement: "修正 hero 布局偏移",
      operations: [{ kind: "css", file: "src/pages/campaign/CampaignPage.module.css", selector: ".hero", property: "margin-left", value: "12px" }],
      allowedFiles: ["src/pages/campaign/Other.module.css"], rollbackArtifact: "artifact-test",
    });
    expect(() => validatePatchPlan(plan, profile, sourceMap)).toThrow(/allowedFiles/);
  });

  it("rejects allowed files outside the profile write globs", () => {
    const plan = buildPlan({
      round: 1, targetViolationIds: ["layout:hero"], expectedImprovement: "修正 hero 布局偏移",
      operations: [{ kind: "css", file: "src/config.module.css", selector: ".hero", property: "margin-left", value: "12px" }],
      allowedFiles: ["src/config.module.css"], rollbackArtifact: "artifact-test",
    });
    expect(() => validatePatchPlan(plan, profile, sourceMap)).toThrow(/allowedWriteGlobs/);
  });

  it("rejects more than five allowed files", () => {
    const files = Array.from({ length: 6 }, (_, index) => `src/pages/campaign/file-${index}.module.css`);
    const plan = {
      round: 1, targetViolationIds: ["layout:hero"], expectedImprovement: "修正 hero 布局偏移",
      operations: files.map((file) => ({ kind: "css" as const, file, selector: ".hero", property: "margin-left", value: "12px" })),
      allowedFiles: files, rollbackArtifact: "artifact-test",
    };
    expect(() => validatePatchPlan(buildPlan(plan), profile, sourceMap)).toThrow(/allowedFiles/);
  });

  it("accepts a bounded repair plan", () => {
    const plan = buildPlan({
      round: 1, targetViolationIds: ["layout:hero"], expectedImprovement: "修正 hero 布局偏移",
      operations: [{ kind: "css", file: "src/pages/campaign/CampaignPage.module.css", selector: ".hero", property: "margin-left", value: "12px" }],
      allowedFiles: ["src/pages/campaign/CampaignPage.module.css"], rollbackArtifact: "artifact-test",
    });
    expect(() => validatePatchPlan(plan, profile, sourceMap)).not.toThrow();
  });
});

describe("planTargetedRepair", () => {
  it("derives css margin fixes from layout deltas", async () => {
    const workspace = await createWorkspace({ "src/pages/campaign/CampaignPage.module.css": ".hero {\n  display: flex;\n}\n" });
    const plan = await planTargetedRepair({
      violations: [layoutViolation], sourceMap, round: 1, rollbackArtifact: "artifact-test",
      readFile: (path) => readFile(join(workspace.root, path), "utf8"),
    });
    expect(plan.operations[0]).toMatchObject({
      kind: "css", file: "src/pages/campaign/CampaignPage.module.css", selector: ".hero", property: "margin-left", value: "-12px",
    });
    expect(plan.allowedFiles).toContain("src/pages/campaign/CampaignPage.module.css");
  });

  it("accumulates onto the existing margin value instead of overwriting it", async () => {
    const workspace = await createWorkspace({ "src/pages/campaign/CampaignPage.module.css": ".hero {\n  margin-left: 4px;\n}\n" });
    const plan = await planTargetedRepair({
      violations: [layoutViolation], sourceMap, round: 2, rollbackArtifact: "artifact-test",
      readFile: (path) => readFile(join(workspace.root, path), "utf8"),
    });
    expect(plan.operations[0]).toMatchObject({ property: "margin-left", value: "-8px" });
  });
});

describe("shouldContinueRepair", () => {
  it("stops after three repair rounds or two consecutive sub-point gains", () => {
    expect(shouldContinueRepair([80])).toBe(true);
    expect(shouldContinueRepair([80, 82])).toBe(true);
    expect(shouldContinueRepair([80, 82, 84, 85])).toBe(false);
    expect(shouldContinueRepair([80, 80.4, 80.8])).toBe(false);
  });
});

describe("applyPatchPlan", () => {
  it("applies a css patch inside the selector block without duplicates", async () => {
    const workspace = await createWorkspace({ "src/pages/campaign/CampaignPage.module.css": ".hero {\n  display: flex;\n  gap: 24px;\n}\n\n.cards {\n  gap: 12px;\n}\n" });
    const plan = buildPlan({
      round: 1, targetViolationIds: ["layout:hero"], expectedImprovement: "修正 hero 布局偏移",
      operations: [{ kind: "css", file: "src/pages/campaign/CampaignPage.module.css", selector: ".hero", property: "margin-left", value: "-12px" }],
      allowedFiles: ["src/pages/campaign/CampaignPage.module.css"], rollbackArtifact: "artifact-test",
    });
    await applyPatchPlan(plan, workspace);
    const css = await readFile(join(workspace.root, "src/pages/campaign/CampaignPage.module.css"), "utf8");
    expect(css).toContain("margin-left: -12px;");
    expect(css).toContain("display: flex;");
    expect(css.match(/margin-left/g)).toHaveLength(1);
    await applyPatchPlan(plan, workspace);
    const cssAgain = await readFile(join(workspace.root, "src/pages/campaign/CampaignPage.module.css"), "utf8");
    expect(cssAgain.match(/margin-left/g)).toHaveLength(1);
  });

  it("applies a tsx attribute patch to the node with the matching data attribute", async () => {
    const workspace = await createWorkspace({
      "src/pages/campaign/CampaignPage.tsx": 'export function CampaignPage() {\n  return (\n    <section data-d2c-node-id="hero" className="hero">\n      <h1 data-d2c-node-id="hero-title">夏日好物节</h1>\n    </section>\n  );\n}\n',
    });
    const plan = buildPlan({
      round: 1, targetViolationIds: ["text:hero-title"], expectedImprovement: "修正标题内容",
      operations: [{ kind: "tsx", file: "src/pages/campaign/CampaignPage.tsx", nodeId: "hero-title", attribute: "data-d2c-variant", value: "compact" }],
      allowedFiles: ["src/pages/campaign/CampaignPage.tsx"], rollbackArtifact: "artifact-test",
    });
    await applyPatchPlan(plan, workspace);
    const tsx = await readFile(join(workspace.root, "src/pages/campaign/CampaignPage.tsx"), "utf8");
    expect(tsx).toContain('data-d2c-variant="compact"');
    expect(tsx).toContain('data-d2c-node-id="hero-title"');
  });

  it("applies a spec json patch scoped to one node", async () => {
    const workspace = await createWorkspace({
      "src/pages/campaign/activity-spec.json": JSON.stringify({ nodes: [{ id: "hero", layout: { mode: "flex", gap: 24 } }] }),
    });
    const plan = buildPlan({
      round: 1, targetViolationIds: ["layout:hero"], expectedImprovement: "修正 hero 间距",
      operations: [{ kind: "spec", nodeId: "hero", path: "layout.gap", value: 16 }],
      allowedFiles: ["src/pages/campaign/activity-spec.json"], rollbackArtifact: "artifact-test",
    });
    await applyPatchPlan(plan, workspace, undefined, { specPath: "src/pages/campaign/activity-spec.json" });
    const spec = JSON.parse(await readFile(join(workspace.root, "src/pages/campaign/activity-spec.json"), "utf8"));
    expect(spec.nodes[0].layout.gap).toBe(16);
  });

  it("snapshots a rollback artifact before touching files", async () => {
    const workspace = await createWorkspace({ "src/pages/campaign/CampaignPage.module.css": ".hero {\n  gap: 24px;\n}\n" });
    const storeRoot = await mkdtemp(join(tmpdir(), "d2c-artifacts-"));
    roots.push(storeRoot);
    const store = await FileArtifactStore.create(storeRoot, "run-repair");
    const plan = buildPlan({
      round: 1, targetViolationIds: ["layout:hero"], expectedImprovement: "修正 hero 布局偏移",
      operations: [{ kind: "css", file: "src/pages/campaign/CampaignPage.module.css", selector: ".hero", property: "gap", value: "16px" }],
      allowedFiles: ["src/pages/campaign/CampaignPage.module.css"], rollbackArtifact: "artifact-test",
    });
    await applyPatchPlan(plan, workspace, store);
    const artifacts = await store.list();
    expect(artifacts.some((artifact) => artifact.kind === "rollback")).toBe(true);
  });
});

