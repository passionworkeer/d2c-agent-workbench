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

export interface ProductionDemo {
  sampleId: string;
  recordedAt: string;
  run: ProductionRunDetail;
  artifacts: Record<string, Awaited<ReturnType<typeof getProductionArtifact>>>;
  screenshots: Record<string, string>;
  preview?: ProductionPreview;
}

export interface ProductionPreview {
  runId: string;
  url: string;
  builtAt: string;
  nodes: Record<string, { name: string; role: string; file?: string; styleFile?: string; styleSelector?: string }>;
}

export async function getProductionDemo(sampleId: string): Promise<ProductionDemo> {
  const demo = await readJson<ProductionDemo>(await fetch(`/production-demos/${encodeURIComponent(sampleId)}.json`));
  if (demo.sampleId !== sampleId || demo.run.sampleId !== sampleId || demo.run.state !== "COMPLETED") throw new Error("该页面没有完整的实跑演示记录，请先生成并保存证据包。");
  return demo;
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
  /** 设计质量软观察（VLM 对参考图与渲染图的主观评估），不进 finalScore */
  designQuality: number | null;
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
  /** 完整原图，独立于 Figma 导出图与代码运行截图 */
  referenceUrl?: string;
  payload: ProductionRunPayload;
}

/** 真实样例的整页参考图（缩略图与 Figma 导入包共用同一份原图） */
export const SAMPLE_ATLAS_URL: Record<string, string> = {
  "commerce-feed": commerceFeedAtlasUrl,
  "summer-game-festival": gameFestivalAtlasUrl,
  "pet-red-packet": petRedPacketAtlasUrl,
};

const referenceNodesOf = (raw: string, ids: string[]): Record<string, Rect> => {
  const spec = JSON.parse(raw) as ActivitySpec;
  return Object.fromEntries(ids.map((id) => [id, spec.nodes.find((node) => node.id === id)!.sourceBox]));
};

export const GOLDEN_SAMPLES: GoldenSample[] = [
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
      referenceNodes: referenceNodesOf(commerceFeedSpecJson, ["top-nav", "commerce-search", "quick-actions", "promo-banner", "product-grid", "product-tissue-card", "product-tea-card", "bottom-nav"]),
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
      referenceNodes: referenceNodesOf(gameFestivalSpecJson, ["festival-hero", "collab-header", "task-list", "benefit-panel", "reward-cards", "daily-tasks", "activity-tabs"]),
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
      referenceNodes: referenceNodesOf(petRedPacketSpecJson, ["pet-app-nav", "level-progress", "pet-stage", "feed-action", "pet-task-section", "bottom-nav"]),
    },
  },
];
