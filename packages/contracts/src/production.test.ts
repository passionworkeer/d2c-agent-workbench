import { describe, expect, it } from "vitest";
import {
  activitySpecSchema,
  patchPlanSchema,
  targetProjectProfileSchema,
} from "./index";

const validNode = {
  id: "page",
  name: "活动页",
  role: "page",
  sourceBox: { x: 0, y: 0, width: 1440, height: 1200 },
  layout: {
    mode: "flow",
    direction: "column",
    width: { mode: "fixed", value: 1440 },
    height: { mode: "hug" },
    rationale: "页面根节点使用正常文档流",
  },
  responsive: [{ viewport: "mobile", rule: "stack" }],
  visual: { opacity: 1 },
  tokenRefs: [],
  evidence: [{ type: "pixel", sourceId: "desktop", observation: "全页边界", confidence: 0.98 }],
  confidence: 0.98,
  reviewState: "accepted",
  children: [],
};

const validSpec = {
  version: "2.0",
  page: {
    id: "campaign",
    name: "夏日活动",
    route: "/campaign",
    canonicalViewport: { width: 1440, height: 1200 },
    background: { type: "solid", value: "#ffffff" },
  },
  breakpoints: [{ name: "mobile", minWidth: 0, maxWidth: 767 }],
  tokens: [],
  assets: [],
  nodes: [validNode],
  interactions: [],
  unresolved: [],
};

describe("activitySpecSchema", () => {
  it("accepts evidence, stable node ids and responsive constraints", () => {
    const parsed = activitySpecSchema.parse(validSpec);
    expect(parsed.version).toBe("2.0");
    expect(parsed.nodes[0]?.evidence[0]?.type).toBe("pixel");
  });

  it("rejects absolute nodes without a rationale", () => {
    const node = {
      ...validNode,
      role: "decoration",
      layout: { ...validNode.layout, mode: "absolute", rationale: "" },
    };
    expect(() => activitySpecSchema.parse({ ...validSpec, nodes: [node] })).toThrow();
  });

  it("rejects duplicate stable node ids", () => {
    expect(() => activitySpecSchema.parse({ ...validSpec, nodes: [validNode, validNode] })).toThrow();
  });
});

describe("targetProjectProfileSchema", () => {
  const validProfile = {
    repositoryPath: "examples/activity-target",
    framework: "react",
    language: "typescript",
    packageManager: "pnpm",
    routeEntry: "src/App.tsx",
    generatedRoot: "src/pages/campaign",
    assetRoot: "public/campaign",
    styleStrategy: "css-modules",
    commands: {
      typecheck: ["pnpm", "typecheck"],
      build: ["pnpm", "build"],
      dev: ["pnpm", "dev"],
    },
    previewUrl: "http://127.0.0.1:4173/campaign",
    allowedWriteGlobs: ["src/pages/campaign/**", "public/campaign/**"],
    designSystemRoots: ["src/components"],
    tokenRoots: ["src/styles/tokens.css"],
  };

  it("accepts an explicitly bounded React target", () => {
    expect(targetProjectProfileSchema.parse(validProfile).framework).toBe("react");
  });

  it("rejects absolute and traversal paths", () => {
    expect(() => targetProjectProfileSchema.parse({ ...validProfile, generatedRoot: "../outside" })).toThrow();
    expect(() => targetProjectProfileSchema.parse({ ...validProfile, assetRoot: "C:\\outside" })).toThrow();
  });

  it("rejects generated roots outside allowed write globs", () => {
    expect(() => targetProjectProfileSchema.parse({
      ...validProfile,
      generatedRoot: "src/generated",
    })).toThrow();
  });
});

describe("patchPlanSchema", () => {
  it("limits repair scope to five files and three rounds", () => {
    const base = {
      round: 1,
      targetViolationIds: ["layout:hero"],
      expectedImprovement: "恢复 Hero 间距",
      operations: [{ kind: "css", file: "src/pages/campaign/page.css", selector: ".hero", property: "gap", value: "24px" }],
      allowedFiles: ["src/pages/campaign/page.css"],
      rollbackArtifact: "artifact:round-0",
    };
    expect(patchPlanSchema.parse(base).round).toBe(1);
    expect(() => patchPlanSchema.parse({ ...base, round: 4 })).toThrow();
    expect(() => patchPlanSchema.parse({ ...base, allowedFiles: ["1", "2", "3", "4", "5", "6"] })).toThrow();
  });
});
