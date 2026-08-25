import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const skill = resolve(root, "skills/d2c-agent-workbench");

describe("可导出的 D2C Skill", () => {
  it("包含 Agent 安装所需的 canonical 文件", () => {
    for (const file of [
      "SKILL.md",
      "agents/openai.yaml",
      "references/workflow.md",
      "references/design-system-reuse.md",
      "references/evaluation-and-repair.md",
      "references/examples.md",
      "scripts/scan-design-assets.mjs",
      "assets/d2c-config.example.json",
    ]) {
      expect(existsSync(resolve(skill, file)), file).toBe(true);
    }
  });

  it("只读扫描本仓库中的组件、样式和脚本", () => {
    const raw = execFileSync(process.execPath, [resolve(skill, "scripts/scan-design-assets.mjs"), root], {
      encoding: "utf8",
    });
    const report = JSON.parse(raw) as {
      components: string[];
      styles: string[];
      packageScripts: Record<string, Record<string, string>>;
    };

    expect(report.components.some((path) => path.endsWith("apps/web/src/App.tsx"))).toBe(true);
    expect(report.styles.some((path) => path.endsWith("apps/web/src/styles.css"))).toBe(true);
    expect(report.packageScripts.root).toMatchObject({ build: "pnpm -r build" });
  });
});
