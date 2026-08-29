import type { ActivitySpec, ProductionViolation, SpecEditOp, TargetProjectProfile, TraceEvent, ComponentMapping, Rect } from "@d2c/contracts";

// 生产模式 API client：ActivitySpec → 真实构建/渲染/评测/修复闭环。
// 与 lib/api.ts 同模式：readJson 统一错误处理，SSE 订阅复用 EventSource。

export interface ProductionRunDetail {
  id: string;
  mode: "production";
  status: "running" | "completed" | "failed" | "needs_review";
  state: string;
  iteration: number;
  createdAt: string;
  artifacts: Array<{ id: string; kind: string; path: string; createdAt: string }>;
  violations: ProductionViolation[];
  events: TraceEvent[];
  mappings?: ComponentMapping[];
}

export interface ProductionRunPayload {
  spec: ActivitySpec;
  profile: TargetProjectProfile;
  mappings?: ComponentMapping[];
  referenceNodes?: Record<string, Rect>;
}

const TERMINAL_STATES = new Set(["COMPLETED", "FAILED", "NEEDS_REVIEW"]);

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let error: { message?: unknown; code?: unknown } = {};
    try {
      error = (await response.json()) as { message?: unknown };
    } catch {
      // 非 JSON 错误体（代理错误等）
    }
    const message = typeof error.message === "string" && error.message.trim() ? error.message : `请求失败（HTTP ${response.status}）`;
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export async function createProductionRun(payload: ProductionRunPayload): Promise<{ runId: string }> {
  return readJson(await fetch("/api/production/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }));
}

export async function getProductionRun(runId: string): Promise<ProductionRunDetail> {
  return readJson(await fetch(`/api/production/runs/${runId}`));
}

export function subscribeToProductionRun(
  runId: string,
  onEvent: (event: TraceEvent) => void,
  onError?: () => void,
): () => void {
  const source = new EventSource(`/api/production/runs/${runId}/events`);
  let sawTerminal = false;
  source.onmessage = (message) => {
    try {
      const event = JSON.parse(message.data) as TraceEvent;
      if (TERMINAL_STATES.has(event.state)) sawTerminal = true;
      onEvent(event);
    } catch {
      // 忽略无法解析的心跳/坏帧
    }
  };
  source.onerror = () => {
    if (sawTerminal) return;
    onError?.();
    source.close();
  };
  return () => source.close();
}

export async function confirmProductionMapping(runId: string, nodeId: string, status: "accepted" | "review" | "unmapped"): Promise<{ mappings: ComponentMapping[] }> {
  return readJson(await fetch(`/api/production/runs/${runId}/confirm-mapping`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nodeId, status }),
  }));
}

export async function editProductionRun(runId: string, editOps: SpecEditOp[]): Promise<{ spec: ActivitySpec }> {
  return readJson(await fetch(`/api/production/runs/${runId}/edit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ editOps }),
  }));
}

export async function repairProductionRun(runId: string): Promise<{ runId: string }> {
  return readJson(await fetch(`/api/production/runs/${runId}/repair`, { method: "POST" }));
}

export async function getProductionArtifact(runId: string, artifactId: string): Promise<{ artifact: { id: string; kind: string; path: string }; content: unknown }> {
  return readJson(await fetch(`/api/production/runs/${runId}/artifacts/${artifactId}`));
}

/** 黄金样例：一个含可修复 Hero 间距问题的活动页（与 examples/activity-pages/campaign 对齐） */
export const GOLDEN_PRODUCTION_SAMPLE: ProductionRunPayload = {
  spec: {
    version: "2.0",
    page: {
      id: "page", name: "Campaign", route: "/campaign/summer",
      canonicalViewport: { width: 1440, height: 900 }, background: { type: "solid", value: "#ffffff" },
    },
    breakpoints: [{ name: "mobile", minWidth: 0, maxWidth: 767 }],
    tokens: [{ name: "color/accent", value: "#ff5000", source: "repository" }],
    assets: [],
    nodes: [
      {
        id: "page", role: "page", name: "页面", sourceBox: { x: 0, y: 0, width: 1440, height: 900 },
        layout: { mode: "flow", width: { mode: "fill" }, height: { mode: "hug" }, rationale: "整页纵向流式布局" },
        responsive: [], visual: { opacity: 1 }, tokenRefs: [],
        evidence: [{ type: "user", sourceId: "golden", observation: "黄金样例输入", confidence: 1 }],
        confidence: 1, reviewState: "accepted", children: ["hero"],
      },
      {
        id: "hero", parentId: "page", role: "section", name: "主视觉", sourceBox: { x: 0, y: 0, width: 1440, height: 500 },
        layout: { mode: "flex", direction: "column", width: { mode: "fill" }, height: { mode: "fixed", value: 500 }, rationale: "首屏区块" },
        responsive: [], visual: { opacity: 1 }, tokenRefs: ["color/accent"],
        evidence: [{ type: "user", sourceId: "golden", observation: "黄金样例主视觉", confidence: 1 }],
        confidence: .9, reviewState: "accepted", children: ["hero-title"],
      },
      {
        id: "hero-title", parentId: "hero", role: "text", name: "标题", sourceBox: { x: 40, y: 40, width: 600, height: 72 },
        layout: { mode: "flow", width: { mode: "hug" }, height: { mode: "hug" }, rationale: "标题按内容尺寸" },
        responsive: [], visual: { opacity: 1, fontSize: 48, fontWeight: 700 }, tokenRefs: [],
        content: { text: "夏日好物节 · 全场 5 折" },
        evidence: [{ type: "prd", sourceId: "golden-prd", observation: "标题文案", confidence: 1 }],
        confidence: .95, reviewState: "accepted", children: [],
      },
    ],
    interactions: [], unresolved: [],
  },
  profile: {
    repositoryPath: "examples/activity-target", framework: "react", language: "typescript", packageManager: "pnpm",
    routeEntry: "src/App.tsx", generatedRoot: "src/pages/campaign", assetRoot: "public/campaign", styleStrategy: "css-modules",
    commands: { install: ["pnpm", "install"], typecheck: ["pnpm", "typecheck"], build: ["pnpm", "build"], dev: ["pnpm", "dev"] },
    previewUrl: "http://127.0.0.1:4173/campaign/summer",
    allowedWriteGlobs: ["src/pages/campaign/**", "public/campaign/**"],
    designSystemRoots: ["src/components"], tokenRoots: [],
  },
  mappings: [],
  referenceNodes: { hero: { x: 0, y: 0, width: 1440, height: 500 } },
};
