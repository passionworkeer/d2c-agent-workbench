// MiniMax 模型凭证装配：环境变量优先，其次根目录 .env 文件（只认 key/url/model 三个键）。
// 凭证只存在于服务端请求生命周期：不写入日志 / Run / Artifact / HTTP 响应。

export interface ModelConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

const DEFAULT_BASE_URL = "https://api.minimaxi.com/anthropic";
const DEFAULT_MODEL = "MiniMax-M3";

/** 极简 .env 解析：仅提取 key / url / model 三行，去空白与包裹引号；其余键一概忽略。 */
function parseEnvFile(content: string): { key?: string; url?: string; model?: string } {
  const parsed: { key?: string; url?: string; model?: string } = {};
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*(key|url|model)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const value = match[2]!.replace(/^["']|["']$/g, "");
    if (value) parsed[match[1] as "key" | "url" | "model"] = value;
  }
  return parsed;
}

export function loadModelConfig(options: {
  env?: Record<string, string | undefined>;
  envFile?: string;
} = {}): ModelConfig {
  const env = options.env ?? process.env;
  const file = parseEnvFile(options.envFile ?? "");
  return {
    apiKey: env.MINIMAX_API_KEY || file.key || "",
    baseUrl: env.MINIMAX_BASE_URL || file.url || DEFAULT_BASE_URL,
    model: env.MINIMAX_MODEL || file.model || DEFAULT_MODEL,
  };
}

/** 把密钥从错误的 message/stack 里抹掉后再向上抛，防止日志与响应泄漏凭证。 */
export function redactModelError(error: Error, secret: string): Error {
  if (!secret) return error;
  const redacted = new Error(error.message.split(secret).join("***"));
  if (error.stack) redacted.stack = error.stack.split(secret).join("***");
  return redacted;
}
