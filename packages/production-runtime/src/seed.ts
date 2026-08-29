import { spawn, type SpawnOptions } from "node:child_process";
import { cp, readdir, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import type { RunWorkspace } from "./workspace";
import { buildMinimalEnv, terminateProcessTree } from "./command";

// 工作区播种：把目标仓库骨架复制进隔离工作区（忽略 node_modules/.git/dist 等重目录），
// 之后生成的文件与真实命令都在这份副本上执行，不触碰目标仓库本身。

const IGNORED_DIRECTORIES = new Set(["node_modules", ".git", "dist", ".worktrees", ".data"]);

// 仓库自身的测试文件不进生产工作区：它们可能以相对路径引用仓库外的 fixture
// （如 examples/activity-pages 的 spec JSON），隔离复制后路径必然断裂挡住 typecheck；
// 工作区只负责构建交付页面，仓库测试质量由仓库自己的 CI 守护。
const TEST_FILE_PATTERN = new RegExp("(?:^|[\\\\/])([^\\\\/]+)\\.(test|spec)\\.[a-z]+$", "i");

export async function seedWorkspaceFrom(sourceRoot: string, workspace: RunWorkspace): Promise<string[]> {
  const entries = await readdir(sourceRoot, { withFileTypes: true });
  const copied: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
    const source = join(sourceRoot, entry.name);
    const target = resolve(workspace.root, entry.name);
    await cp(source, target, { recursive: true, filter: (candidate) => !TEST_FILE_PATTERN.test(candidate) });
    copied.push(entry.name);
  }
  return copied;
}

/** 找一个空闲 TCP 端口，用于工作区 vite preview 渲染服务 */
export function getFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

export interface PreviewServerHandle {
  url: string;
  port: number;
  dispose: () => Promise<void>;
}

export function buildPreviewSpawnOptions(cwd: string): SpawnOptions {
  return {
    cwd,
    env: buildMinimalEnv(),
    shell: process.platform === "win32",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  };
}

/** 在工作区启动 vite preview（服务于 Playwright 渲染），返回可释放的服务句柄 */
export async function startPreviewServer(input: {
  cwd: string;
  port: number;
  executable?: string;
  timeoutMs?: number;
}): Promise<PreviewServerHandle> {
  const executable = input.executable ?? "pnpm";
  const child = spawn(executable, ["exec", "vite", "preview", "--port", String(input.port), "--strictPort", "--host", "127.0.0.1"], buildPreviewSpawnOptions(input.cwd));
  const url = `http://127.0.0.1:${input.port}`;
  let spawnError: Error | undefined;
  let exited = false;
  let exitCode: number | null = null;
  let exitSignal: NodeJS.Signals | null = null;
  let stderr = "";
  child.once("error", (cause) => { spawnError = cause; });
  child.once("close", (code, signal) => {
    exited = true;
    exitCode = code;
    exitSignal = signal;
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    if (stderr.length < 2_000) stderr += chunk.toString("utf8").slice(0, 2_000 - stderr.length);
  });
  const started = Date.now();
  while (Date.now() - started < (input.timeoutMs ?? 30_000)) {
    if (spawnError || exited) {
      await terminateProcessTree(child).catch(() => undefined);
      const reason = spawnError?.message
        ?? `exitCode=${exitCode ?? "null"}${exitSignal ? ` signal=${exitSignal}` : ""}${stderr.trim() ? ` · ${stderr.trim()}` : ""}`;
      throw new Error(`vite preview 启动失败：${reason}`);
    }
    const reachable = await fetch(url, { signal: AbortSignal.timeout(800) }).then((response) => response.ok || response.status === 404).catch(() => false);
    if (reachable) {
      return {
        url,
        port: input.port,
        dispose: () => terminateProcessTree(child),
      };
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  await terminateProcessTree(child);
  throw new Error(`vite preview 未在 ${input.timeoutMs ?? 30_000}ms 内就绪（port ${input.port}）`);
}
