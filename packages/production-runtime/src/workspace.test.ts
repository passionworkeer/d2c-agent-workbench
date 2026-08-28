import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TargetProjectProfile } from "@d2c/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { RunWorkspace } from "./index";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

const profile: TargetProjectProfile = {
  repositoryPath: "target", framework: "react", language: "typescript", packageManager: "pnpm",
  routeEntry: "src/App.tsx", generatedRoot: "src/pages/campaign", assetRoot: "public/campaign", styleStrategy: "css-modules",
  commands: { typecheck: ["pnpm", "typecheck"], build: ["pnpm", "build"], dev: ["pnpm", "dev"] },
  previewUrl: "http://127.0.0.1:4173", allowedWriteGlobs: ["src/pages/campaign/**", "public/campaign/**"],
  designSystemRoots: ["src/components"], tokenRoots: [],
};

describe("RunWorkspace", () => {
  it("writes generated files and copies declared assets inside allowed globs", async () => {
    const root = await mkdtemp(join(tmpdir(), "d2c-workspace-"));
    roots.push(root);
    await writeFile(join(root, "hero.png"), "image");
    const workspace = await RunWorkspace.create(join(root, "workspace"), profile);
    await workspace.apply({
      files: { "src/pages/campaign/Page.tsx": "export const Page = () => null;" },
      assets: [{ source: join(root, "hero.png"), target: "public/campaign/hero.png" }],
    });
    expect(await readFile(join(root, "workspace/src/pages/campaign/Page.tsx"), "utf8")).toContain("Page");
    expect(await readFile(join(root, "workspace/public/campaign/hero.png"), "utf8")).toBe("image");
  });

  it("refuses traversal and writes outside allowed globs", async () => {
    const root = await mkdtemp(join(tmpdir(), "d2c-workspace-"));
    roots.push(root);
    const workspace = await RunWorkspace.create(join(root, "workspace"), profile);
    await expect(workspace.writeFile("../secret", "x")).rejects.toThrow(/workspace/);
    await expect(workspace.writeFile("src/config.ts", "x")).rejects.toThrow(/allowedWriteGlobs/);
  });
});
