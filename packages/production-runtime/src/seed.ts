import { spawn } from "node:child_process";
import { cp, readdir, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import type { RunWorkspace } from "./workspace";

// 工作区播种：把目标仓库骨架复制进隔离工作区（忽略 node_modules/.git/dist 等重目录），
// 之后生成的文件与真实命令都在这份副本上执行，不触碰目标仓库本身。

const IGNORED_DIRECTORIES = new Set(["node_modules", ".git", "dist", ".worktrees", ".data"]);

export async function seedWorkspaceFrom(sourceRoot: string, workspace: RunWorkspace): Promise<string[]> {
  const entries = await readdir(sourceRoot, { withFileTypes: true });
  const copied: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
    const source = join(sourceRoot, entry.name);
    const target = resolve(workspace.root, entry.name);
    await cp(source, target, { recursive: true });
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

/** 在工作区启动 vite preview（服务于 Playwright 渲染），返回可释放的服务句柄 */
export async function startPreviewServer(input: {
  cwd: string;
  port: number;
  executable?: string;
  timeoutMs?: number;
}): Promise<PreviewServerHandle> {
  const executable = input.executable ?? "pnpm";
  const child = spawn(executable, ["exec", "vite", "preview", "--port", String(input.port), "--strictPort", "--host", "127.0.0.1"], {
    cwd: input.cwd,
    // Windows 下 pnpm 是 .CMD 垫片，需 shell 才能执行（命令为固定构造，无用户输入）
    shell: process.platform === "win32",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const url = `http://127.0.0.1:${input.port}`;
  const started = Date.now();
  while (Date.now() - started < (input.timeoutMs ?? 30_000)) {
    const reachable = await fetch(url, { signal: AbortSignal.timeout(800) }).then((response) => response.ok || response.status === 404).catch(() => false);
    if (reachable) {
      return {
        url,
        port: input.port,
        dispose: async () => {
          if (process.platform === "win32") {
            spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
          } else {
            child.kill("SIGKILL");
          }
          await new Promise((done) => setTimeout(done, 300));
        },
      };
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  child.kill("SIGKILL");
  throw new Error(`vite preview 未在 ${input.timeoutMs ?? 30_000}ms 内就绪（port ${input.port}）`);
}
