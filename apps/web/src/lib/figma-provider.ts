import type { EditOp } from "@d2c/canvas-ops";
import type { UISpec } from "@d2c/contracts";

// Figma 回写设置与代理调用：PAT 只存浏览器 localStorage（设置面板 / 回写面板），
// 绝不写入仓库任何文件；浏览器 → 本地 Fastify 代理（PAT 走 X-Figma-Token 请求头）→
// Figma REST，规避 CORS。与 X-LLM-Key 同模式。

export interface FigmaSettings {
  pat: string;
  fileKey: string;
  baseUrl: string;
}

export const DEFAULT_FIGMA_SETTINGS: FigmaSettings = {
  pat: "",
  fileKey: "",
  baseUrl: "https://api.figma.com",
};

const STORAGE_KEY = "d2c-agent-workbench.figma.v1";

export function loadFigmaSettings(): FigmaSettings {
  if (typeof localStorage === "undefined") return DEFAULT_FIGMA_SETTINGS;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_FIGMA_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<FigmaSettings>;
    return {
      pat: typeof parsed.pat === "string" ? parsed.pat : "",
      fileKey: typeof parsed.fileKey === "string" ? parsed.fileKey : "",
      baseUrl:
        typeof parsed.baseUrl === "string" && parsed.baseUrl
          ? parsed.baseUrl
          : DEFAULT_FIGMA_SETTINGS.baseUrl,
    };
  } catch {
    return DEFAULT_FIGMA_SETTINGS;
  }
}

export function saveFigmaSettings(settings: FigmaSettings): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export interface FigmaNodeChangePreview {
  nodeId: string;
  fields: Record<string, unknown>;
  summary: string;
}

export interface FigmaPatchOutcome {
  ok: boolean;
  dryRun?: boolean;
  transport?: "rest" | "comment";
  fileUrl?: string;
  message?: string;
  nodeChanges?: FigmaNodeChangePreview[];
  skipped?: Array<{ reason: string }>;
  degradations?: Array<{ from: string; to: string; reason: string }>;
  summary?: string;
  errorMessage?: string;
}

interface FigmaServerResponse {
  ok?: boolean;
  dryRun?: boolean;
  transport?: "rest" | "comment";
  fileUrl?: string;
  message?: string;
  nodeChanges?: FigmaNodeChangePreview[];
  skipped?: Array<{ reason: string }>;
  degradations?: Array<{ from: string; to: string; reason: string }>;
  summary?: string;
}

interface ServerError {
  code?: string;
  message?: string;
}

export interface FigmaPatchRequestInput {
  spec: UISpec;
  editOps: EditOp[];
  settings: FigmaSettings;
  /** true 只返回 patch 预览（Preview 按钮），不写 Figma */
  dryRun?: boolean;
}

export async function applyFigmaPatchViaProvider(
  input: FigmaPatchRequestInput,
  fetchImpl: typeof fetch = fetch,
): Promise<FigmaPatchOutcome> {
  if (!input.settings.pat) {
    return { ok: false, errorMessage: "请先填写 Figma PAT（写权限，仅存浏览器 localStorage）" };
  }
  if (!input.settings.fileKey) {
    return { ok: false, errorMessage: "请先填写 Figma File Key（文件 URL 里 file/ 后那段）" };
  }
  try {
    const response = await fetchImpl("/api/figma/patch", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-figma-token": input.settings.pat,
      },
      body: JSON.stringify({
        fileKey: input.settings.fileKey,
        uiSpec: input.spec,
        editOps: input.editOps,
        baseUrl: input.settings.baseUrl,
        dryRun: input.dryRun === true,
      }),
    });
    if (!response.ok) {
      const errBody = (await response.json().catch(() => ({}))) as ServerError;
      return { ok: false, errorMessage: errBody.message ?? `Figma ${response.status}` };
    }
    const body = (await response.json()) as FigmaServerResponse;
    return {
      ok: true,
      dryRun: body.dryRun,
      transport: body.transport,
      fileUrl: body.fileUrl,
      message: body.message,
      nodeChanges: body.nodeChanges ?? [],
      skipped: body.skipped,
      degradations: body.degradations,
      summary: body.summary,
    };
  } catch (error) {
    return {
      ok: false,
      errorMessage: error instanceof Error ? error.message : "Figma 代理不可达",
    };
  }
}
