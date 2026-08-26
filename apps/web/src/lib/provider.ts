import type { UISpec } from "@d2c/contracts";
import { parseIntent, type EditOp, type IntentResult } from "@d2c/canvas-ops";

// 浏览器 → 本地 Fastify 代理 → MiniMax：
// key 走 X-LLM-Key 请求头，绝不进仓库文件 / 下载报告 / 截图；
// 服务端永远不持久化（仅本次请求生命周期内存里出现一次）。
export type ProviderId = "rule" | "llm";

export interface ProviderSettings {
  provider: ProviderId;
  baseUrl: string;
  model: string;
  key: string;
}

export const DEFAULT_SETTINGS: ProviderSettings = {
  provider: "rule",
  baseUrl: "https://api.minimaxi.com/anthropic",
  model: "MiniMax-M3",
  key: "",
};

const STORAGE_KEY = "d2c-agent-workbench.provider.v1";

export function loadProviderSettings(): ProviderSettings {
  if (typeof localStorage === "undefined") return DEFAULT_SETTINGS;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<ProviderSettings>;
    return {
      provider: parsed.provider === "llm" ? "llm" : "rule",
      baseUrl: typeof parsed.baseUrl === "string" && parsed.baseUrl ? parsed.baseUrl : DEFAULT_SETTINGS.baseUrl,
      model: typeof parsed.model === "string" && parsed.model ? parsed.model : DEFAULT_SETTINGS.model,
      key: typeof parsed.key === "string" ? parsed.key : "",
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveProviderSettings(settings: ProviderSettings): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export interface InterpretOutcome {
  intent: IntentResult;
  provider: "rule" | "llm";
  fallback: boolean;
  errorMessage?: string;
}

// 把 spec 拍平成 id → 名称/角色 的轻量投影，避免把整个 UISpec 喂给上游。
function summarizeSpec(spec: UISpec): Array<{ id: string; name: string; role?: string; figmaComponent?: string }> {
  const out: Array<{ id: string; name: string; role?: string; figmaComponent?: string }> = [];
  function walk(node: { id: string; name: string; semanticRole?: string; component?: { figmaComponent?: string }; children: typeof spec.root.children }): void {
    out.push({ id: node.id, name: node.name, role: node.semanticRole, figmaComponent: node.component?.figmaComponent });
    node.children.forEach(walk);
  }
  walk(spec.root);
  return out;
}

interface LlmServerResponse {
  ops?: EditOp[];
  explanation?: string;
  provider?: string;
}

interface LlmServerError {
  code?: string;
  message?: string;
}

// interpretViaProvider: 单入口规则/LLM provider 派发。
// - provider=rule：直接调 canvas-ops.parseIntent（默认；离线 / 演示零风险）
// - provider=llm：POST /api/canvas/interpret（key 在 X-LLM-Key 头），失败 → 降级到规则解析 + toolCalls fallback:true + ChatPanel 提示
export async function interpretViaProvider(
  text: string,
  spec: UISpec,
  settings: ProviderSettings,
  fetchImpl: typeof fetch = fetch,
): Promise<InterpretOutcome> {
  if (settings.provider !== "llm") {
    return { intent: parseIntentLocal(text, spec), provider: "rule", fallback: false };
  }
  try {
    const response = await fetchImpl("/api/canvas/interpret", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-llm-key": settings.key,
      },
      body: JSON.stringify({
        text,
        specSummary: summarizeSpec(spec),
        baseUrl: settings.baseUrl,
        model: settings.model,
      }),
    });
    if (!response.ok) {
      const errBody = (await response.json().catch(() => ({}))) as LlmServerError;
      const fallbackIntent = parseIntentLocal(text, spec);
      return {
        intent: fallbackIntent,
        provider: "llm",
        fallback: true,
        errorMessage: errBody.message ?? `LLM ${response.status}`,
      };
    }
    const body = (await response.json()) as LlmServerResponse;
    const ops = Array.isArray(body.ops) ? body.ops : [];
    return {
      intent: {
        ops,
        explanation: body.explanation ?? "由 LLM 给出",
        confidence: 0.95,
      },
      provider: "llm",
      fallback: false,
    };
  } catch (error) {
    const fallbackIntent = parseIntentLocal(text, spec);
    return {
      intent: fallbackIntent,
      provider: "llm",
      fallback: true,
      errorMessage: error instanceof Error ? error.message : "LLM 不可达",
    };
  }
}

// 同步规则解析：parseIntent 是 sync 函数，这里走直接 import 避免异步派发看起来奇怪。
function parseIntentLocal(text: string, spec: UISpec): IntentResult {
  return parseIntent(text, spec) ?? { ops: [], explanation: "暂未识别该指令", confidence: 0 };
}
