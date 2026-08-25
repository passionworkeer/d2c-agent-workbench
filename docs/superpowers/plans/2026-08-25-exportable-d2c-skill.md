# 可导出 D2C Skill 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 D2C 工作台中增加可离线下载的完整 Agent Skill，并保证 Skill 源码、ZIP、Web 下载入口和端到端验收一致。

**Architecture:** 仓库中的 `skills/d2c-agent-workbench/` 是唯一源码；只读资产扫描器帮助 Agent 判断能否复用组件库与 Design Token。根构建脚本把 canonical Skill 确定性打包到 Vite `public` 目录，Web 仅用静态链接下载，不引入后端接口。

**Tech Stack:** Markdown Agent Skill、Node.js ESM、fflate、React 19、Vitest、Testing Library、Playwright、pnpm workspace。

---

## 文件结构

- `skills/d2c-agent-workbench/SKILL.md`：Skill 触发描述、输入决策和主工作流。
- `skills/d2c-agent-workbench/agents/openai.yaml`：Skill UI 元数据和默认调用示例。
- `skills/d2c-agent-workbench/references/workflow.md`：从设计输入到交付的逐步执行协议。
- `skills/d2c-agent-workbench/references/design-system-reuse.md`：组件、Token 与历史资产的检索和证据规则。
- `skills/d2c-agent-workbench/references/evaluation-and-repair.md`：六维评测、阈值和最多三轮 Repair。
- `skills/d2c-agent-workbench/references/examples.md`：有资产、无资产、截图降级三类完整案例。
- `skills/d2c-agent-workbench/scripts/scan-design-assets.mjs`：只读扫描目标仓库并输出 JSON。
- `skills/d2c-agent-workbench/assets/d2c-config.example.json`：可选企业资产配置样例。
- `scripts/skill-assets.test.ts`：验证 canonical Skill、扫描器与 ZIP 一致性。
- `scripts/build-skill-zip.mjs`：生成或检查静态 ZIP。
- `apps/web/public/d2c-agent-workbench-skill.zip`：Web 实际下载文件。
- `apps/web/src/App.tsx`：增加导出入口。
- `apps/web/src/styles.css`：让链接复用按钮样式并保持次级层级。
- `apps/web/src/App.test.tsx`：验证下载链接契约。
- `tests/e2e/demo.spec.ts`：真实下载并解压检查内容。
- `package.json`、`pnpm-lock.yaml`：增加 fflate 与 Skill 构建/检查脚本。

### Task 1：用测试固定 canonical Skill 与资产扫描契约

**Files:**
- Create: `scripts/skill-assets.test.ts`
- Create: `skills/d2c-agent-workbench/SKILL.md`
- Create: `skills/d2c-agent-workbench/agents/openai.yaml`
- Create: `skills/d2c-agent-workbench/references/workflow.md`
- Create: `skills/d2c-agent-workbench/references/design-system-reuse.md`
- Create: `skills/d2c-agent-workbench/references/evaluation-and-repair.md`
- Create: `skills/d2c-agent-workbench/references/examples.md`
- Create: `skills/d2c-agent-workbench/scripts/scan-design-assets.mjs`
- Create: `skills/d2c-agent-workbench/assets/d2c-config.example.json`

- [ ] **Step 1：先写扫描器失败测试**

```ts
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
    ]) expect(existsSync(resolve(skill, file)), file).toBe(true);
  });

  it("只读扫描本仓库中的组件、样式和脚本", () => {
    const raw = execFileSync(process.execPath, [resolve(skill, "scripts/scan-design-assets.mjs"), root], {
      encoding: "utf8",
    });
    const report = JSON.parse(raw);
    expect(report.components.some((path: string) => path.endsWith("apps/web/src/App.tsx"))).toBe(true);
    expect(report.styles.some((path: string) => path.endsWith("apps/web/src/styles.css"))).toBe(true);
    expect(report.packageScripts.root).toMatchObject({ build: "pnpm -r build" });
  });
});
```

- [ ] **Step 2：运行测试并确认因文件缺失而失败**

Run: `pnpm exec vitest run scripts/skill-assets.test.ts`

Expected: FAIL，错误指出 canonical 文件不存在或扫描脚本不存在。

- [ ] **Step 3：实现最小只读扫描器**

扫描器使用 `node:fs/promises` 和 `node:path`，忽略 `.git`、`node_modules`、`dist`、`build`、`coverage`、`.next`、`.turbo`，最多遍历 10,000 个文件。输出字段固定为：

```js
{
  repository: absolutePath,
  components: [],
  stories: [],
  codeConnect: [],
  tokens: [],
  styles: [],
  configs: [],
  conventions: [],
  packageScripts: {},
  notes: []
}
```

组件匹配 `*.tsx|*.jsx|*.vue|*.svelte`，Stories 匹配 `*.stories.*`，Code Connect 匹配 `*.figma.*`，Token 匹配文件名含 `token|theme|variable` 的 JSON/TS/CSS，样式匹配 CSS/SCSS，配置与约定匹配 `package.json`、`tsconfig*.json`、Tailwind 配置、`AGENTS.md`、`CONTRIBUTING.md`。

- [ ] **Step 4：编写完整 Skill 内容**

`SKILL.md` frontmatter：

```yaml
---
name: d2c-agent-workbench
description: 将 Figma Bundle、节点树或参考图转换为可维护前端代码；当任务涉及 D2C、组件库与 Design Token 复用、UISpec、视觉评测或定向修复时使用。
---
```

正文必须明确：检查输入、扫描资产、生成 UISpec、映射组件/Token、代码计划、生成、构建渲染、六维 Eval、最多三轮 Repair、交付证据。长规则分别路由到四个 `references/` 文件。

`agents/openai.yaml`：

```yaml
interface:
  display_name: "D2C Agent 工作台"
  short_description: "把 Figma 与设计系统资产转换为可维护前端代码"
  brand_color: "#9BD500"
  default_prompt: "使用 $d2c-agent-workbench 分析这个设计输入，优先复用现有组件库和 Design Token，并交付可运行代码与评测报告。"
policy:
  allow_implicit_invocation: true
```

配置样例包含 `designInput`、`targetRepository`、`framework`、`componentRoots`、`tokenRoots`、`storybookRoots`、`commands` 和 `qualityThreshold`，只提供路径和命令示例，不写真实密钥。

- [ ] **Step 5：运行单测、官方校验和扫描器**

Run:

```powershell
pnpm exec vitest run scripts/skill-assets.test.ts
python C:\Users\04735\.codex\skills\.system\skill-creator\scripts\quick_validate.py skills/d2c-agent-workbench
node skills/d2c-agent-workbench/scripts/scan-design-assets.mjs .
```

Expected: Vitest PASS；校验输出 `Skill is valid!`；扫描 JSON 能发现 `App.tsx`、`styles.css` 和根 package scripts。

- [ ] **Step 6：提交 canonical Skill**

```powershell
git add scripts/skill-assets.test.ts skills/d2c-agent-workbench
git commit -m "feat(skill): 增加可复用D2C工作流与资产扫描器"
```

### Task 2：用测试驱动可复现 ZIP 构建

**Files:**
- Modify: `scripts/skill-assets.test.ts`
- Create: `scripts/build-skill-zip.mjs`
- Create: `apps/web/public/d2c-agent-workbench-skill.zip`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1：先添加 ZIP 失败测试**

```ts
import { readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";

it("ZIP 与 canonical Skill 的路径和内容完全一致", () => {
  execFileSync(process.execPath, [resolve(root, "scripts/build-skill-zip.mjs"), "--check"]);
  const archive = unzipSync(readFileSync(resolve(root, "apps/web/public/d2c-agent-workbench-skill.zip")));
  expect(strFromU8(archive["d2c-agent-workbench/SKILL.md"])).toContain("name: d2c-agent-workbench");
  expect(Object.keys(archive)).toContain("d2c-agent-workbench/scripts/scan-design-assets.mjs");
});
```

- [ ] **Step 2：安装依赖后运行测试，确认因构建脚本/ZIP 缺失失败**

先在根 `devDependencies` 增加 `"fflate": "^0.8.2"`，运行 `pnpm install` 更新锁文件；再运行 `pnpm exec vitest run scripts/skill-assets.test.ts`。

Expected: FAIL，原因是 `scripts/build-skill-zip.mjs` 或目标 ZIP 不存在，而非依赖解析错误。

- [ ] **Step 3：实现生成与 `--check`**

`build-skill-zip.mjs` 固定输入 `skills/d2c-agent-workbench`、输出 `apps/web/public/d2c-agent-workbench-skill.zip`。递归文件路径排序后用 `zipSync` 打包，入口统一加 `d2c-agent-workbench/`；`--check` 解压已有 ZIP，逐项比较路径集合和字节内容，任何不一致均以非零状态退出。

- [ ] **Step 4：连接根脚本并生成 ZIP**

```json
{
  "scripts": {
    "skill:build": "node scripts/build-skill-zip.mjs",
    "skill:check": "node scripts/build-skill-zip.mjs --check",
    "test": "pnpm skill:check && pnpm exec vitest run scripts/skill-assets.test.ts && pnpm -r test"
  }
}
```

Run: `pnpm skill:build && pnpm test`

Expected: ZIP 生成，`skill:check` 和全部现有测试 PASS。

- [ ] **Step 5：提交 ZIP 管线**

```powershell
git add package.json pnpm-lock.yaml scripts apps/web/public/d2c-agent-workbench-skill.zip
git commit -m "feat(skill): 增加可校验的离线ZIP导出"
```

### Task 3：用 Web 单测驱动导出入口

**Files:**
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1：先写下载链接失败测试**

```ts
it("提供不依赖后端的 D2C Skill 下载入口", () => {
  render(<App />);
  const link = screen.getByRole("link", { name: "导出 D2C Skill" });
  expect(link).toHaveAttribute("href", "/d2c-agent-workbench-skill.zip");
  expect(link).toHaveAttribute("download", "d2c-agent-workbench-skill.zip");
});
```

- [ ] **Step 2：运行单测并确认链接缺失**

Run: `pnpm --filter @d2c/web test -- App.test.tsx`

Expected: FAIL，Testing Library 报告找不到名称为“导出 D2C Skill”的 link。

- [ ] **Step 3：实现静态下载链接**

在 `App.tsx` 引入 `PackageOpen`，在顶部操作区上传按钮之前加入：

```tsx
<a
  className="button secondary skill-export"
  href="/d2c-agent-workbench-skill.zip"
  download="d2c-agent-workbench-skill.zip"
>
  <PackageOpen size={15} />导出 D2C Skill
</a>
```

在 `styles.css` 为 `.button` 增加 `text-decoration: none`，并保持现有白色次级按钮外观。

- [ ] **Step 4：运行 Web 测试与类型检查**

Run: `pnpm --filter @d2c/web test && pnpm --filter @d2c/web typecheck`

Expected: Web 5 个测试全部 PASS，TypeScript 无错误。

- [ ] **Step 5：提交 Web 入口**

```powershell
git add apps/web/src/App.tsx apps/web/src/App.test.tsx apps/web/src/styles.css
git commit -m "feat(web): 增加D2C Skill下载入口"
```

### Task 4：端到端下载验收与全仓验证

**Files:**
- Modify: `tests/e2e/demo.spec.ts`

- [ ] **Step 1：先写真实下载 E2E**

```ts
import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";

test("可下载并解压完整 D2C Skill", async ({ page }) => {
  await page.goto("/");
  const pending = page.waitForEvent("download");
  await page.getByRole("link", { name: "导出 D2C Skill" }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("d2c-agent-workbench-skill.zip");
  const archive = unzipSync(await readFile((await download.path())!));
  expect(strFromU8(archive["d2c-agent-workbench/SKILL.md"])).toContain("name: d2c-agent-workbench");
  expect(Object.keys(archive)).toContain("d2c-agent-workbench/references/examples.md");
});
```

- [ ] **Step 2：运行 E2E 并确认测试可捕获下载问题**

先临时把断言文件名写为错误值，运行 `pnpm e2e`，确认失败后恢复正确断言；这证明测试真实观察了浏览器下载事件。

- [ ] **Step 3：运行完整验证**

Run:

```powershell
pnpm skill:check
python C:\Users\04735\.codex\skills\.system\skill-creator\scripts\quick_validate.py skills/d2c-agent-workbench
pnpm typecheck
pnpm test
pnpm build
pnpm e2e
git diff --check
```

Expected: 全部命令退出码 0；E2E 同时覆盖原中文 Mock 演示与 Skill 下载。

- [ ] **Step 4：提交 E2E 验收**

```powershell
git add tests/e2e/demo.spec.ts
git commit -m "test(e2e): 覆盖D2C Skill真实下载与解压"
```

### Task 5：完成分支并同步私有 GitHub

**Files:**
- Modify only if verification exposes a scoped defect.

- [ ] **Step 1：核对差异和敏感信息**

Run: `git status --short && git diff master...HEAD --stat && git log --oneline master..HEAD && git grep -n -E "(FIGMA_TOKEN|OPENAI_API_KEY|ghp_)" -- skills scripts apps/web/public`

Expected: 工作区干净；提交均为中文 conventional commits；Skill 与 ZIP 不含密钥。

- [ ] **Step 2：按 finishing-a-development-branch 复验并合并**

用户已明确要求“同步 GitHub”，因此验证通过后把功能分支以非交互方式合并到本地 `master`，合并提交使用：

```text
merge: 合并可导出D2C Skill功能
```

- [ ] **Step 3：推送并验证私有仓库**

Run:

```powershell
git push origin master
gh repo view passionworkeer/d2c-agent-workbench --json isPrivate,url,defaultBranchRef
git status --short --branch
```

Expected: `isPrivate` 为 `true`，默认分支指向已合并提交，本地与 `origin/master` 同步且工作区干净。
