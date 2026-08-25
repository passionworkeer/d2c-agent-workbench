import type { ComponentMapping, EvaluationReport, TraceEvent, UISpec, WorkflowState } from "@d2c/contracts";

export interface RunDetail {
  id: string;
  status: "running" | "completed" | "failed";
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
  return response.json() as Promise<T>;
}

export async function startDemoRun(): Promise<{ runId: string }> {
  return readJson(await fetch("/api/runs/demo", { method: "POST" }));
}

export async function uploadBundle(file: File): Promise<{ runId: string }> {
  const body = new FormData();
  body.append("bundle", file);
  return readJson(await fetch("/api/runs/upload", { method: "POST", body }));
}

export async function getRun(runId: string): Promise<RunDetail> {
  return readJson(await fetch(`/api/runs/${runId}`));
}

export function subscribeToRun(
  runId: string,
  onEvent: (event: TraceEvent) => void,
  onError?: () => void,
): () => void {
  const source = new EventSource(`/api/runs/${runId}/events`);
  source.onmessage = (message) => onEvent(JSON.parse(message.data) as TraceEvent);
  source.onerror = () => {
    source.close();
    onError?.();
  };
  return () => source.close();
}
