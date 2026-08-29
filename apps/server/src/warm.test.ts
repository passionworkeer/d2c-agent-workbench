import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { warmDependencyCache } from "./warm";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** 伪造注册表指向的目标仓库结构：examples/activity-target（5 个样例共享这一个仓库）。 */
async function createFakeRepositoryBase(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "warm-repo-"));
  roots.push(base);
  const repository = join(base, "examples", "activity-target");
  await mkdir(repository, { recursive: true });
  await writeFile(join(repository, "package.json"), JSON.stringify({ name: "activity-target", private: true }), "utf8");
  return base;
}

async function createDataRoot(): Promise<string> {
  const dataRoot = await mkdtemp(join(tmpdir(), "warm-data-"));
  roots.push(dataRoot);
  return dataRoot;
}

describe("warmDependencyCache", () => {
  it("seeds one warm workspace per unique repository and runs the profile install command", async () => {
    const base = await createFakeRepositoryBase();
    const dataRoot = await createDataRoot();
    const calls: Array<{ cwd: string; command: string[] }> = [];
    const warmed = await warmDependencyCache({
      dataRoot,
      repositoryBase: base,
      install: async ({ cwd, command }) => {
        calls.push({ cwd, command });
        // 模拟 pnpm install 的产物
        await mkdir(join(cwd, "node_modules"), { recursive: true });
        return { exitCode: 0, stderr: "" };
      },
    });
    // 5 个注册样例共享 examples/activity-target：每个仓库只预热一次
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toEqual(["pnpm", "install"]);
    expect(warmed).toEqual(["examples/activity-target"]);
    // 预热工作区里能读到播种复制来的 package.json
    const seeded = await readFile(join(dataRoot, "warm", "examples-activity-target", "package.json"), "utf8");
    expect(seeded).toContain("activity-target");
  });

  it("skips repositories that are already warm", async () => {
    const base = await createFakeRepositoryBase();
    const dataRoot = await createDataRoot();
    await mkdir(join(dataRoot, "warm", "examples-activity-target", "node_modules"), { recursive: true });
    let installCalls = 0;
    const warmed = await warmDependencyCache({
      dataRoot,
      repositoryBase: base,
      install: async () => {
        installCalls += 1;
        return { exitCode: 0, stderr: "" };
      },
    });
    expect(installCalls).toBe(0);
    expect(warmed).toEqual([]);
  });

  it("reports install failure via log without throwing", async () => {
    const base = await createFakeRepositoryBase();
    const dataRoot = await createDataRoot();
    const logs: string[] = [];
    const warmed = await warmDependencyCache({
      dataRoot,
      repositoryBase: base,
      install: async () => ({ exitCode: 1, stderr: "ERR_PNPM_NO_OFFLINE" }),
      log: (message) => logs.push(message),
    });
    expect(warmed).toEqual([]);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("预热失败");
    expect(logs[0]).toContain("ERR_PNPM_NO_OFFLINE");
  });
});
