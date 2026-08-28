import { fileURLToPath } from "node:url";
import type { TargetProjectProfile } from "@d2c/contracts";
import { describe, expect, it } from "vitest";
import { inspectTargetProject } from "./index";

const sampleRoot = fileURLToPath(new URL("../../../examples/sample-design-system/", import.meta.url));

const profile: TargetProjectProfile = {
  repositoryPath: "examples/sample-design-system",
  framework: "react",
  language: "typescript",
  packageManager: "pnpm",
  routeEntry: "components/Header.tsx",
  generatedRoot: "generated/campaign",
  assetRoot: "public/campaign",
  styleStrategy: "plain-css",
  commands: {
    typecheck: ["pnpm", "typecheck"],
    build: ["pnpm", "build"],
    dev: ["pnpm", "dev"],
  },
  previewUrl: "http://127.0.0.1:4173/campaign",
  allowedWriteGlobs: ["generated/campaign/**", "public/campaign/**"],
  designSystemRoots: ["components"],
  tokenRoots: [],
  storybookRoots: ["components"],
  codeConnectRoots: ["components"],
};

describe("inspectTargetProject", () => {
  it("indexes components with repository, Storybook and Code Connect evidence", async () => {
    const index = await inspectTargetProject({ root: sampleRoot, profile });
    const productCard = index.components.find((item) => item.name === "ProductCard");
    expect(productCard?.props).toEqual(["tone", "badge", "title"]);
    expect(productCard?.figmaNames).toContain("Product Card / Default");
    expect(productCard?.evidence.map((item) => item.sourceId)).toEqual(expect.arrayContaining([
      "components/ProductCard.tsx",
      "components/ProductCard.stories.tsx",
      "components/ProductCard.figma.tsx",
    ]));
    expect(index.commitHash).toMatch(/^(?:[0-9a-f]{7,40}|unknown)$/);
  });

  it("produces a deterministic version hash", async () => {
    const first = await inspectTargetProject({ root: sampleRoot, profile });
    const second = await inspectTargetProject({ root: sampleRoot, profile });
    expect(second.versionHash).toBe(first.versionHash);
  });

  it("rejects roots that do not contain the configured repository", async () => {
    await expect(inspectTargetProject({ root: `${sampleRoot}/missing`, profile })).rejects.toThrow();
  });
});
