import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { RunWorkspace, runAllowedCommand, seedWorkspaceFrom } from "@d2c/production-runtime";
import { listProductionSampleIds, resolveTargetBySampleId } from "./profiles";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

export interface WarmDependencyCacheOptions {
  /** 预热目录根；默认与生产路由共用的 <cwd>/.data/production */
  dataRoot?: string;
  /** 目标仓库路径的解析基准；测试注入临时目录 */
  repositoryBase?: string;
  /** 安装实现；默认走 runAllowedCommand 白名单执行 profile.commands.install */
  install?: (input: { cwd: string; command: string[] }) => Promise<{ exitCode: number; stderr: string }>;
  log?: (message: string) => void;
}

/**
 * 服务端启动即后台预热依赖：把每个目标仓库播种到 .data/production/warm/<slug>
 * 并跑一次 install，填充 pnpm 全局 store——首个生产闭环不再付 1–2 分钟的
 * 冷启动下载，演示节奏不断。预热目录独立于各 run 的隔离工作区，只借 install
 * 副作用（store 变热），不参与任何执行路径。
 */
export async function warmDependencyCache(options: WarmDependencyCacheOptions = {}): Promise<string[]> {
  const dataRoot = resolve(options.dataRoot ?? join(process.cwd(), ".data/production"));
  const repositoryBase = options.repositoryBase ? resolve(options.repositoryBase) : repoRoot;
  const log = options.log ?? (() => undefined);
  const install = options.install ?? (async ({ cwd, command }) => {
    const result = await runAllowedCommand(command, { cwd, allowedCommands: [command], timeoutMs: 600_000 });
    return { exitCode: result.exitCode, stderr: result.stderr };
  });
  const warmed: string[] = [];
  const seen = new Set<string>();
  for (const sampleId of listProductionSampleIds()) {
    const { profile } = resolveTargetBySampleId(sampleId);
    if (!profile.commands.install) continue;
    // 多个样例可共享同一目标仓库：每个仓库只预热一次
    if (seen.has(profile.repositoryPath)) continue;
    seen.add(profile.repositoryPath);
    const slug = profile.repositoryPath.replaceAll(/[^A-Za-z0-9.-]+/g, "-");
    const warmRoot = join(dataRoot, "warm", slug);
    if (existsSync(join(warmRoot, "node_modules"))) continue;
    await rm(warmRoot, { recursive: true, force: true });
    const started = Date.now();
    const workspace = await RunWorkspace.create(warmRoot, profile);
    await seedWorkspaceFrom(resolve(repositoryBase, profile.repositoryPath), workspace);
    const result = await install({ cwd: warmRoot, command: profile.commands.install });
    if (result.exitCode === 0) {
      warmed.push(profile.repositoryPath);
      log(`依赖缓存已预热：${profile.repositoryPath}（${Math.round((Date.now() - started) / 1000)}s）`);
    } else {
      log(`依赖缓存预热失败（不影响运行，首个闭环将自行安装）：${profile.repositoryPath} · ${result.stderr.slice(0, 160)}`);
    }
  }
  return warmed;
}
