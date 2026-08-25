import type { ComponentMapping, EvaluationReport, TraceEvent, UISpec, WorkflowState } from "@d2c/contracts";

const TERMINAL_STATES: ReadonlySet<WorkflowState> = new Set([
  "COMPLETED",
  "FAILED",
  "NEEDS_REVIEW",
]);

export interface RunDetail {
  id: string;
  status: "running" | "completed" | "failed" | "needs_review";
  state: WorkflowState;
  previewUrl?: string;
  uiSpec: UISpec;
  mappings: ComponentMapping[];
  events: TraceEvent[];
  evaluations: EvaluationReport[];
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let error: { message?: unknown } = {};
    try {
      error = (await response.json()) as { message?: unknown };
    } catch {
      // Vite 代理和网关错误可能没有 JSON 响应体。
    }
    const message = typeof error.message === "string" && error.message.trim()
      ? error.message
      : `请求失败（HTTP ${response.status}）`;
    throw new Error(message);
  }
  // 2xx 但响应体不是 JSON（Vite dev 代理偶发空响应、HTML 错误页）也要抛出，
  // 否则下游解构 `.runId` 等会拿到 undefined 后静默失败。
  const text = await response.text();
  if (!text) throw new Error("服务返回了空响应");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("服务响应不是合法 JSON");
  }
}

export async function uploadBundle(file: File): Promise<{ runId: string }> {
  const body = new FormData();
  body.append("bundle", file);
  return readJson(await fetch("/api/runs/upload", { method: "POST", body }));
}

export async function getRun(runId: string): Promise<RunDetail> {
  return readJson(await fetch(`/api/runs/${runId}`));
}

// EventSource 的 onerror 在正常完成流关闭时也会触发（per WHATWG 规范，浏览器把它当作连接错误）。
// 服务端只在终态时主动 end()，因此只要我们收到过终态事件、随后的 onerror 就忽略，
// 否则才真正当作流错误冒泡给调用方。
export function subscribeToRun(
  runId: string,
  onEvent: (event: TraceEvent) => void,
  onError?: () => void,
): () => void {
  const source = new EventSource(`/api/runs/${runId}/events`);
  let receivedTerminal = false;

  source.onmessage = (message) => {
    let event: TraceEvent;
    try {
      event = JSON.parse(message.data) as TraceEvent;
    } catch {
      // 服务端推送的不是合法 JSON —— 等同于流错误。
      source.close();
      onError?.();
      return;
    }
    onEvent(event);
    if (TERMINAL_STATES.has(event.state)) receivedTerminal = true;
  };

  source.onerror = () => {
    source.close();
    if (!receivedTerminal) onError?.();
  };

  return () => source.close();
}
