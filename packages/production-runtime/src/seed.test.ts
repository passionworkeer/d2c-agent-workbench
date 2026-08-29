import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TargetProjectProfile } from "@d2c/contracts";
import { buildPreviewSpawnOptions, getFreePort, seedWorkspaceFrom, startPreviewServer, type RunWorkspace } from "./index";
import { RunWorkspace as Workspace } from "./workspace";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

const profile: TargetProjectProfile = {
  repositoryPath: "target", framework: "react", language: "typescript", packageManager: "pnpm",
  routeEntry: "src/App.tsx", generatedRoot: "src/pages/campaign", assetRoot: "public/campaign", styleStrategy: "css-modules",
  commands: { typecheck: ["pnpm", "typecheck"], build: ["pnpm", "build"], dev: ["pnpm", "dev"] },
  previewUrl: "http://127.0.0.1:4173", allowedWriteGlobs: ["src/pages/campaign/**", "public/campaign/**"],
  designSystemRoots: ["src/components"], tokenRoots: [],
};

describe("seedWorkspaceFrom", () => {
  it("copies the target repository into the workspace ignoring heavy directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "d2c-seed-"));
    roots.push(root);
    const target = join(root, "target");
    await mkdir(join(target, "src"), { recursive: true });
    await mkdir(join(target, "node_modules", "react"), { recursive: true });
    await mkdir(join(target, ".git"), { recursive: true });
    await writeFile(join(target, "package.json"), "{}");
    await writeFile(join(target, "src", "App.tsx"), "export default function App() { return null; }");
    await writeFile(join(target, "node_modules", "react", "index.js"), "heavy");
    await writeFile(join(target, ".git", "HEAD"), "ref");

    const workspace: RunWorkspace = await Workspace.create(join(root, "workspace"), profile);
    await seedWorkspaceFrom(target, workspace);
    expect(await readFile(join(workspace.root, "package.json"), "utf8")).toBe("{}");
    expect(await readFile(join(workspace.root, "src", "App.tsx"), "utf8")).toContain("App");
    const { access } = await import("node:fs/promises");
    await expect(access(join(workspace.root, "node_modules"))).rejects.toThrow();
    await expect(access(join(workspace.root, ".git"))).rejects.toThrow();
  });
});

describe("getFreePort", () => {
  it("returns a usable port number", async () => {
    const port = await getFreePort();
    expect(Number.isInteger(port)).toBe(true);
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThan(65536);
  });
});

describe("buildPreviewSpawnOptions", () => {
  it("does not pass unrelated server secrets to the preview process", () => {
    process.env.D2C_TEST_SECRET = "must-not-leak";
    try {
      const options = buildPreviewSpawnOptions(process.cwd());
      expect(options.env?.D2C_TEST_SECRET).toBeUndefined();
      expect(options.env?.PATH ?? options.env?.Path).toBeTruthy();
    } finally {
      delete process.env.D2C_TEST_SECRET;
    }
  });

  it("reports a preview process startup failure without waiting for the readiness timeout", async () => {
    const started = Date.now();
    await expect(startPreviewServer({
      cwd: process.cwd(),
      port: await getFreePort(),
      executable: "d2c-preview-command-that-does-not-exist",
      timeoutMs: 5_000,
    })).rejects.toThrow(/启动失败/);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
