import type { ActivitySpec, ProductionMetrics, ProductionViolation, SpecEditOp, TraceEvent, ComponentMapping, Rect, SemanticReviewEvidence } from "@d2c/contracts";
// 三张真实移动活动页：examples/activity-pages 下 fixture 是单一事实源，?raw 内联进前端包
import commerceFeedSpecJson from "../../../../examples/activity-pages/commerce-feed/activity-spec.json?raw";
import gameFestivalSpecJson from "../../../../examples/activity-pages/summer-game-festival/activity-spec.json?raw";
import petRedPacketSpecJson from "../../../../examples/activity-pages/pet-red-packet/activity-spec.json?raw";
// 图集原图以 Vite 资产 URL 引入：下载 Figma 导入包时按需 fetch 成 base64 随包携带
import commerceFeedAtlasUrl from "../../../../examples/activity-pages/commerce-feed/reference.jpg?url";
import gameFestivalAtlasUrl from "../../../../examples/activity-pages/summer-game-festival/reference.jpg?url";
import petRedPacketAtlasUrl from "../../../../examples/activity-pages/pet-red-packet/reference.jpg?url";

// 生产模式 API client：ActivitySpec → 真实构建/渲染/评测/修复闭环。
// 与 lib/api.ts 同模式：readJson 统一错误处理，SSE 订阅复用 EventSource。

export interface ProductionRunDetail {
  id: string;
  mode: "production";
  status: "running" | "completed" | "failed" | "needs_review";
  state: string;
  /** 服务端记录的样例 id：回看历史 run 时报告/面板要如实标注它属于哪个样例 */
  sampleId?: string;
  iteration: number;
  createdAt: string;
  artifacts: Array<{ id: string; kind: string; path: string; createdAt: string }>;
  violations: ProductionViolation[];
  events: TraceEvent[];
  mappings?: ComponentMapping[];
  /** 最近一轮评测指标：null/undefined 表示还没出第一轮 EVALUATED */
  latestEvaluation?: ProductionMetrics;
  /** 最近一轮文本证据：spec 中 role=text 的 content.text vs 渲染 DOM 的 textContent */
  latestTextEvidence?: { expected: string[]; actual: string[] };
  /** 最近一轮语义评审证据：MiniMax 实时评审或服务端注册基准回退（provider 标注来源） */
  latestSemanticReview?: SemanticReviewEvidence;
}

export interface ProductionRunSummary {
  id: string;
  sampleId: string;
  status: ProductionRunDetail["status"];
  state: string;
  iteration: number;
  /** 最近一轮 finalScore：还没跑到评测的 run 为 null */
  finalScore: number | null;
  createdAt: string;
}

export interface ProductionRunPayload {
  sampleId: string;
  spec: ActivitySpec;
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

/** 历史 Run 清单（含重启后重载的记录）：工作台据此只读回看任意一次闭环的证据链 */
export async function listProductionRuns(): Promise<{ runs: ProductionRunSummary[] }> {
  return readJson(await fetch("/api/production/runs"));
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
      if (TERMINAL_STATES.has(event.state)) {
        sawTerminal = true;
        // 终态即关流：服务端随后 end() 会触发 EventSource 自动重连，
        // 重连会被服务端全量重放事件，导致前端事件列表成倍膨胀
        onEvent(event);
        source.close();
        return;
      }
      onEvent(event);
    } catch {
      // 忽略无法解析的心跳/坏帧
    }
  };
  source.onerror = () => {
    if (sawTerminal) {
      source.close();
      return;
    }
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

export interface SemanticReviewOutcome {
  score: number;
  summary: string;
  observations: string[];
  model: string;
}

/** 闭环外 VLM 语义复核：key 走 X-LLM-Key 请求头（仅本次请求生命周期，不落任何报告）。 */
export async function requestSemanticReview(
  runId: string,
  settings: { key: string; baseUrl: string; model: string },
  fetchImpl: typeof fetch = fetch,
): Promise<SemanticReviewOutcome> {
  return readJson(await fetchImpl(`/api/production/runs/${runId}/semantic-review`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-llm-key": settings.key },
    body: JSON.stringify({ baseUrl: settings.baseUrl, model: settings.model }),
  }));
}

/** Figma 导入包的自包含素材（base64 随包携带，见 figma-patcher v2） */
export interface EmbeddedSampleAsset {
  id: string;
  path: string;
  mimeType: string;
  data: string;
}

// 真实样例的图集即整页原图（单一 reference.jpg）；campaign/summer-form 纯语义组件无素材
async function fetchAssetAsBase64(url: string): Promise<{ mimeType: string; data: string }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`素材加载失败（HTTP ${response.status}）`);
  const blob = await response.blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("素材读取失败"));
    reader.readAsDataURL(blob);
  });
  return { mimeType: blob.type || "image/jpeg", data: dataUrl.slice(dataUrl.indexOf(",") + 1) };
}

/** 按样例加载自包含素材：真实样例取整页图集，黄金样例返回空表 */
export async function loadEmbeddedAssets(sampleId: string): Promise<EmbeddedSampleAsset[]> {
  const url = SAMPLE_ATLAS_URL[sampleId];
  if (!url) return [];
  const { mimeType, data } = await fetchAssetAsBase64(url);
  return [{ id: "reference", path: "reference.jpg", mimeType, data }];
}

/** 黄金样例：不同结构的活动页共享同一目标仓库骨架（含可修复的基线间距问题） */
export interface GoldenSample {
  id: string;
  label: string;
  targetRepository: string;
  /** 还原保真说明：真实样例为 390px 手机端整页高保真，黄金样例为演示骨架 */
  fidelity: string;
  /** 真实样例用参考截图做缩略图 */
  thumbnailUrl?: string;
  payload: ProductionRunPayload;
}

/** 真实样例的整页参考图（缩略图与 Figma 导入包共用同一份原图） */
export const SAMPLE_ATLAS_URL: Record<string, string> = {
  "commerce-feed": commerceFeedAtlasUrl,
  "summer-game-festival": gameFestivalAtlasUrl,
  "pet-red-packet": petRedPacketAtlasUrl,
};

export const GOLDEN_SAMPLES: GoldenSample[] = [
  {
    id: "campaign",
    label: "夏日好物节（主视觉页）",
    targetRepository: "examples/activity-target",
    fidelity: "演示骨架 · 目标仓库含一处可修复的基线间距问题",
    payload: {
      sampleId: "campaign",
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
            layout: { mode: "flex", direction: "column", padding: { top: 40, right: 40, bottom: 40, left: 40 }, width: { mode: "fill" }, height: { mode: "fixed", value: 500 }, rationale: "首屏区块" },
            // demo 默认 mobile 自适应：hero 缩放到视口宽度，避免 1440 撑爆 390 触发 overflow P1
            responsive: [{ viewport: "mobile", rule: "resize", value: 390 }],
            visual: { opacity: 1, background: { type: "solid", value: "#f5f6f8" } }, tokenRefs: ["color/accent"],
            evidence: [{ type: "user", sourceId: "golden", observation: "黄金样例主视觉", confidence: 1 }],
            confidence: .9, reviewState: "accepted", children: ["hero-title"],
          },
          {
            id: "hero-title", parentId: "hero", role: "text", name: "标题", sourceBox: { x: 40, y: 40, width: 600, height: 72 },
            layout: { mode: "flow", width: { mode: "hug" }, height: { mode: "hug" }, rationale: "标题按内容尺寸" },
            responsive: [], visual: { opacity: 1, color: "#ff5000", fontSize: 48, fontWeight: 700 }, tokenRefs: ["color/accent"],
            content: { text: "夏日好物节 · 全场 5 折" },
            evidence: [{ type: "prd", sourceId: "golden-prd", observation: "标题文案", confidence: 1 }],
            confidence: .95, reviewState: "accepted", children: [],
          },
        ],
        interactions: [], unresolved: [],
      },
      mappings: [],
      referenceNodes: { hero: { x: 0, y: 0, width: 1440, height: 500 } },
    },
  },
  {
    id: "summer-form",
    label: "体验官招募（表单页）",
    targetRepository: "examples/activity-target",
    fidelity: "演示骨架 · 目标仓库含一处可修复的基线间距问题",
    payload: {
      sampleId: "summer-form",
      spec: {
        version: "2.0",
        page: {
          id: "page", name: "SummerForm", route: "/campaign/summer-form",
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
            confidence: 1, reviewState: "accepted", children: ["form-section"],
          },
          {
            id: "form-section", parentId: "page", role: "section", name: "表单区", sourceBox: { x: 0, y: 0, width: 1440, height: 640 },
            layout: { mode: "flex", direction: "column", gap: 44, padding: { top: 80, right: 60, bottom: 60, left: 60 }, width: { mode: "fill" }, height: { mode: "fixed", value: 640 }, rationale: "表单主区块" },
            responsive: [{ viewport: "mobile", rule: "resize", value: 390 }],
            visual: { opacity: 1, background: { type: "solid", value: "#f7f8f4" } }, tokenRefs: ["color/accent"],
            evidence: [{ type: "user", sourceId: "golden", observation: "黄金样例表单区", confidence: 1 }],
            confidence: .9, reviewState: "accepted", children: ["form-title", "form-body"],
          },
          {
            id: "form-title", parentId: "form-section", role: "text", name: "表单标题", sourceBox: { x: 60, y: 80, width: 520, height: 56 },
            layout: { mode: "flow", width: { mode: "hug" }, height: { mode: "hug" }, rationale: "标题按内容尺寸" },
            responsive: [], visual: { opacity: 1, color: "#ff5000", fontSize: 40, fontWeight: 700 }, tokenRefs: ["color/accent"],
            content: { text: "限时体验官招募 · 填写即领券" },
            evidence: [{ type: "prd", sourceId: "golden-prd", observation: "表单标题文案", confidence: 1 }],
            confidence: .95, reviewState: "accepted", children: [],
          },
          {
            id: "form-body", parentId: "form-section", role: "container", name: "表单主体", sourceBox: { x: 60, y: 180, width: 520, height: 400 },
            layout: { mode: "flex", direction: "column", gap: 24, padding: { top: 24, right: 24, bottom: 24, left: 24 }, width: { mode: "fixed", value: 520 }, height: { mode: "fixed", value: 260 }, rationale: "表单字段纵向排列" },
            responsive: [{ viewport: "mobile", rule: "resize", value: 390 }], visual: { opacity: 1, background: { type: "solid", value: "#ffffff" }, border: "1px solid #e3e5de" }, tokenRefs: [],
            evidence: [{ type: "user", sourceId: "golden", observation: "黄金样例表单主体", confidence: 1 }],
            confidence: .85, reviewState: "accepted", children: ["field-name", "field-phone", "submit-hint"],
          },
          {
            id: "field-name", parentId: "form-body", role: "text", name: "姓名字段", sourceBox: { x: 60, y: 180, width: 520, height: 48 },
            layout: { mode: "flow", width: { mode: "fill" }, height: { mode: "hug" }, rationale: "输入占位" },
            responsive: [], visual: { opacity: 1, color: "#4a4f46", fontSize: 18 }, tokenRefs: [],
            content: { text: "您的姓名" },
            evidence: [{ type: "prd", sourceId: "golden-prd", observation: "字段占位文案", confidence: 1 }],
            confidence: .9, reviewState: "accepted", children: [],
          },
          {
            id: "field-phone", parentId: "form-body", role: "text", name: "手机号字段", sourceBox: { x: 60, y: 252, width: 520, height: 48 },
            layout: { mode: "flow", width: { mode: "fill" }, height: { mode: "hug" }, rationale: "输入占位" },
            responsive: [], visual: { opacity: 1, color: "#4a4f46", fontSize: 18 }, tokenRefs: [],
            content: { text: "手机号（用于发放奖励）" },
            evidence: [{ type: "prd", sourceId: "golden-prd", observation: "字段占位文案", confidence: 1 }],
            confidence: .9, reviewState: "accepted", children: [],
          },
          {
            id: "submit-hint", parentId: "form-body", role: "text", name: "提交按钮文案", sourceBox: { x: 60, y: 324, width: 520, height: 56 },
            layout: { mode: "flow", width: { mode: "fill" }, height: { mode: "hug" }, rationale: "按钮文案" },
            responsive: [], visual: { opacity: 1, color: "#ff5000", fontSize: 20, fontWeight: 700 }, tokenRefs: ["color/accent"],
            content: { text: "立即报名 · 100% 中奖" },
            evidence: [{ type: "prd", sourceId: "golden-prd", observation: "按钮文案", confidence: 1 }],
            confidence: .9, reviewState: "accepted", children: [],
          },
        ],
        interactions: [], unresolved: [],
      },
      mappings: [],
      referenceNodes: { "form-section": { x: 0, y: 0, width: 1440, height: 640 } },
    },
  },
  {
    id: "commerce-feed",
    fidelity: "390px 手机端 · 高保真整页还原",
    thumbnailUrl: SAMPLE_ATLAS_URL["commerce-feed"],
    label: "快手商城（信息流页·真实截图）",
    targetRepository: "examples/activity-target",
    payload: {
      sampleId: "commerce-feed",
      spec: JSON.parse(commerceFeedSpecJson) as ActivitySpec,
      mappings: [
        {
          nodeId: "page", figmaComponent: "CommerceFeedRoot",
          codeComponent: "CommerceFeedExperience", importPath: "@/components/activity/CommerceFeedExperience",
          props: { atlasUrl: "/commerce-feed/reference.jpg" },
          confidence: 1, status: "accepted",
          evidence: ["真实截图混合重建：导航/卡片/底栏语义化组件 + 参考图裁切素材，real-pages.test 全量文本与几何校验通过"],
        },
      ],
      referenceNodes: {
        "top-nav": { x: 0, y: 46, width: 390, height: 44 },
        "commerce-search": { x: 12, y: 94, width: 366, height: 42 },
        "quick-actions": { x: 0, y: 142, width: 390, height: 59 },
        "promo-banner": { x: 0, y: 208, width: 390, height: 67 },
        "product-grid": { x: 0, y: 276, width: 390, height: 548 },
        "product-tissue-card": { x: 6, y: 276, width: 190, height: 300 },
        "product-tea-card": { x: 198, y: 276, width: 186, height: 300 },
        "bottom-nav": { x: 0, y: 824, width: 390, height: 43 },
      },
    },
  },
  {
    id: "summer-game-festival",
    fidelity: "390px 手机端 · 高保真整页还原",
    thumbnailUrl: SAMPLE_ATLAS_URL["summer-game-festival"],
    label: "夏日游戏节（任务页·真实截图）",
    targetRepository: "examples/activity-target",
    payload: {
      sampleId: "summer-game-festival",
      spec: JSON.parse(gameFestivalSpecJson) as ActivitySpec,
      mappings: [
        {
          nodeId: "page", figmaComponent: "SummerGameFestivalRoot",
          codeComponent: "SummerGameFestivalExperience", importPath: "@/components/activity/SummerGameFestivalExperience",
          props: { atlasUrl: "/game-festival/reference.jpg" },
          confidence: 1, status: "accepted",
          evidence: ["真实截图混合重建：任务/福利/兑换/Tab 语义化组件 + 主视觉裁切，real-pages.test 全量文本与几何校验通过"],
        },
      ],
      referenceNodes: {
        "festival-hero": { x: 0, y: 0, width: 390, height: 294 },
        "collab-header": { x: 0, y: 272, width: 390, height: 38 },
        "task-list": { x: 8, y: 318, width: 374, height: 116 },
        "benefit-panel": { x: 8, y: 438, width: 374, height: 72 },
        "reward-cards": { x: 8, y: 514, width: 374, height: 66 },
        "daily-tasks": { x: 8, y: 586, width: 374, height: 158 },
        "activity-tabs": { x: 0, y: 761, width: 390, height: 62 },
      },
    },
  },
  {
    id: "pet-red-packet",
    fidelity: "390px 手机端 · 高保真整页还原",
    thumbnailUrl: SAMPLE_ATLAS_URL["pet-red-packet"],
    label: "养萌宠红包（养成页·真实截图）",
    targetRepository: "examples/activity-target",
    payload: {
      sampleId: "pet-red-packet",
      spec: JSON.parse(petRedPacketSpecJson) as ActivitySpec,
      mappings: [
        {
          nodeId: "page", figmaComponent: "PetRedPacketRoot",
          codeComponent: "PetRedPacketExperience", importPath: "@/components/activity/PetRedPacketExperience",
          props: { atlasUrl: "/pet-red-packet/reference.jpg" },
          confidence: 1, status: "accepted",
          evidence: ["真实截图混合重建：养成舞台/喂食/任务区语义化组件 + 标题与舞台素材裁切，real-pages.test 全量文本与几何校验通过"],
        },
      ],
      referenceNodes: {
        "pet-app-nav": { x: 0, y: 0, width: 390, height: 42 },
        "level-progress": { x: 21, y: 144, width: 349, height: 90 },
        "pet-stage": { x: 0, y: 234, width: 390, height: 369 },
        "feed-action": { x: 8, y: 560, width: 374, height: 36 },
        "pet-task-section": { x: 0, y: 604, width: 390, height: 156 },
        "bottom-nav": { x: 0, y: 766, width: 390, height: 53 },
      },
    },
  },
];
