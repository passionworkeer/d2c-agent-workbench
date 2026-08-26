import type { FigmaNodeChange, FigmaPatch } from "@d2c/figma-patcher";
import { toSetNodeChangesBody } from "@d2c/figma-patcher";

// Figma REST 写客户端：PAT 走 X-Figma-Token 请求头经本模块发出，绝不记录日志。
// 主路径 PUT /v1/files/:key/nodes（setNodeChanges）；403/401 时降级为
// POST /v1/files/:key/comments 把 patch JSON 作为评论发布（只读 PAT 也能演示）。

export interface FigmaPatchRequest {
  fileKey: string;
  patch: FigmaPatch;
  pat: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export type FigmaPatchResult =
  | { ok: true; transport: "rest"; fileUrl: string }
  | { ok: true; transport: "comment"; fileUrl: string; message: string }
  | { ok: false; code: "FIGMA_BAD_REQUEST" | "FIGMA_UNAVAILABLE" | "FIGMA_FORBIDDEN"; message: string };

const FIGMA_FILE_KEY_PATTERN = /^[\w-]+$/;
const DEFAULT_BASE_URL = "https://api.figma.com";
const DEFAULT_TIMEOUT_MS = 8000;

function fileUrl(fileKey: string): string {
  return `https://www.figma.com/file/${fileKey}`;
}

function commentMessage(patch: FigmaPatch, nodeChanges: FigmaNodeChange[]): string {
  // 评论是只读降级通道：把变更结构完整贴出来，人可以照着手动改。
  return [
    `[d2c-agent-workbench] 写入被拒，以下变更以评论形式交付（${patch.summary}）：`,
    JSON.stringify(nodeChanges, null, 2),
  ].join("\n");
}

async function requestFigma(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function applyFigmaPatch(request: FigmaPatchRequest): Promise<FigmaPatchResult> {
  const baseUrl = request.baseUrl ?? DEFAULT_BASE_URL;
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = request.fetchImpl ?? fetch;
  const { fileKey, patch, pat } = request;

  if (typeof pat !== "string" || pat.trim() === "") {
    return { ok: false, code: "FIGMA_BAD_REQUEST", message: "缺少 Figma PAT（X-Figma-Token）" };
  }
  if (typeof fileKey !== "string" || !FIGMA_FILE_KEY_PATTERN.test(fileKey)) {
    return { ok: false, code: "FIGMA_BAD_REQUEST", message: "fileKey 非法（应为 Figma 文件 URL 里的文件 key）" };
  }
  const body = toSetNodeChangesBody(patch);
  if (body.nodeChanges.length === 0) {
    return { ok: false, code: "FIGMA_BAD_REQUEST", message: "没有可写入的节点变更" };
  }

  try {
    const response = await requestFigma(
      `${baseUrl}/v1/files/${fileKey}/nodes`,
      {
        method: "PUT",
        headers: { "content-type": "application/json", "x-figma-token": pat },
        body: JSON.stringify(body),
      },
      fetchImpl,
      timeoutMs,
    );

    if (response.ok) {
      return { ok: true, transport: "rest", fileUrl: fileUrl(fileKey) };
    }

    if (response.status === 401 || response.status === 403) {
      // 写权限不足 → 评论降级（只读 PAT 也能走通）
      const commentResponse = await requestFigma(
        `${baseUrl}/v1/files/${fileKey}/comments`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-figma-token": pat },
          body: JSON.stringify({ message: commentMessage(patch, patch.nodeChanges) }),
        },
        fetchImpl,
        timeoutMs,
      );
      if (commentResponse.ok) {
        return {
          ok: true,
          transport: "comment",
          fileUrl: fileUrl(fileKey),
          message: "写权限不足，变更已作为评论发布到该文件（可照评论手动应用）",
        };
      }
      const errText = await commentResponse.text().catch(() => "");
      return {
        ok: false,
        code: "FIGMA_FORBIDDEN",
        message: `写入与评论降级均被拒（${commentResponse.status}${errText ? `：${errText.slice(0, 200)}` : ""}）`,
      };
    }

    if (response.status === 400 || response.status === 404) {
      const errBody = (await response.json().catch(() => ({}))) as { message?: string; err?: string };
      return {
        ok: false,
        code: "FIGMA_BAD_REQUEST",
        message: `Figma 拒绝请求（${response.status}：${errBody.err ?? errBody.message ?? "未给出原因"}）`,
      };
    }

    return { ok: false, code: "FIGMA_UNAVAILABLE", message: `Figma ${response.status}` };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      code: "FIGMA_UNAVAILABLE",
      message: aborted ? "Figma 调用超时" : error instanceof Error ? error.message : "Figma 不可达",
    };
  }
}
