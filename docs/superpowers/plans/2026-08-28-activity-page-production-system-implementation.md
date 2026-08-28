# Activity Page Production System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有 D2C Demo 升级为能从参考图/PRD/资产生成真实 React 页面、完成隔离构建渲染、客观评测、错误归因和局部修复，并提供可编辑原型与 Figma 导出的团队可用 MVP。

**Architecture:** 继续使用现有 TypeScript Monorepo，以 `ActivitySpec v2` 为唯一事实源；新增 `production-runtime` 包承载 Artifact、Workspace、Build、Render、Eval 和 Patch 的系统边界。现有 UISpec/Replay 保持兼容，生产 Orchestrator 使用真实执行结果，Web 通过独立生产模式接入。

**Tech Stack:** TypeScript、Zod、Fastify、React、Puck、Playwright、looks-same、Jimp、Tesseract.js、ts-morph、Vitest、pnpm workspace。

---

## 文件结构

```text
packages/contracts/src/production.ts          ActivitySpec、Profile、Run、Eval、Patch Schema
packages/contracts/src/index.ts               兼容导出
packages/asset-indexer/src/project.ts         目标仓库 Profile 与组件/Token 证据索引
packages/codegen/src/production.ts             CodePlan、真实 TSX/CSS、SourceMap
packages/evaluator/src/production.ts           客观指标、Violation、区域归因
packages/production-runtime/                   Artifact、Workspace、命令、Render、Repair
packages/orchestrator/src/production.ts         真实生产状态机
apps/server/src/production.ts                  Run Store 与 API 服务
apps/server/src/app.ts                         注册生产路由
apps/server/src/vision-production.ts           截图/PRD/资产 Evidence → ActivitySpec
apps/web/src/lib/production-api.ts             生产 API Client
apps/web/src/components/ProductionWorkbench.tsx 生产工作台
apps/web/src/components/PrototypeEditor.tsx    Puck 适配器
apps/web/src/App.tsx                           生产模式入口
apps/web/src/styles.css                        生产 UI 样式
packages/figma-patcher/src/export.ts            HTML-to-Figma 导入包
examples/activity-pages/                       真实黄金 Fixture 与目标仓库
```

## Task 1：ActivitySpec v2 与生产 Contracts

**Files:**
- Create: `packages/contracts/src/production.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/production.test.ts`

- [x] **Step 1: 写失败测试**

```ts
it("rejects structural absolute nodes without rationale", () => {
  expect(() => activitySpecSchema.parse({
    ...validSpec,
    nodes: [{ ...validSpec.nodes[0], layout: { mode: "absolute" } }],
  })).toThrow();
});

it("accepts evidence, stable node ids and responsive constraints", () => {
  expect(activitySpecSchema.parse(validSpec).version).toBe("2.0");
});

it("rejects target profiles whose generated root is not allowed", () => {
  expect(() => targetProjectProfileSchema.parse(invalidProfile)).toThrow();
});
```

- [x] **Step 2: 验证 RED**

Run: `pnpm --filter @d2c/contracts test -- production.test.ts`
Expected: FAIL，提示 `activitySpecSchema` 尚未导出。

- [x] **Step 3: 实现 Schema**

实现并导出：

```ts
activitySpecSchema
activityNodeSchema
evidenceRefSchema
targetProjectProfileSchema
codePlanSchema
sourceMapSchema
productionMetricsSchema
productionViolationSchema
patchPlanSchema
productionRunSchema
```

所有 Schema 使用 `.strict()`，路径字段必须是相对路径，置信度为 `0..1`，Patch 最多 5 个文件、Run 最多 3 轮。

- [x] **Step 4: 验证 GREEN**

Run: `pnpm --filter @d2c/contracts test -- production.test.ts && pnpm --filter @d2c/contracts typecheck`
Expected: PASS。

- [x] **Step 5: 提交**

```bash
git add packages/contracts
git commit -m "feat(contracts): 新增活动页生产协议"
```

## Task 2：Project Inspector 与证据索引

**Files:**
- Create: `packages/asset-indexer/src/project.ts`
- Modify: `packages/asset-indexer/src/index.ts`
- Test: `packages/asset-indexer/src/project.test.ts`

- [x] **Step 1: 写失败测试**

```ts
it("indexes exports, props, stories, Code Connect and tokens with evidence", async () => {
  const index = await inspectTargetProject({ root: fixtureRoot, profile });
  expect(index.components.find((item) => item.name === "ProductCard")?.evidence)
    .toEqual(expect.arrayContaining([expect.objectContaining({ type: "repository" })]));
  expect(index.tokens.some((token) => token.name === "color/accent")).toBe(true);
  expect(index.commitHash).toMatch(/^[0-9a-f]+|unknown$/);
});
```

- [x] **Step 2: 验证 RED**

Run: `pnpm --filter @d2c/asset-indexer test -- project.test.ts`
Expected: FAIL，缺少 `inspectTargetProject`。

- [x] **Step 3: 实现 Inspector**

基于现有 `scanRepo` 增加：

- Profile 路径边界校验。
- `.figma.tsx` / Storybook / Token 文件证据。
- Props 名称和字面量候选。
- 文件哈希和 Git commit hash。
- `ProjectIndex` JSON 可序列化输出。

- [x] **Step 4: 验证 GREEN 并提交**

Run: `pnpm --filter @d2c/asset-indexer test && pnpm --filter @d2c/asset-indexer typecheck`
Expected: PASS。

```bash
git add packages/asset-indexer
git commit -m "feat(indexer): 增强目标仓库组件与令牌索引"
```

## Task 3：ActivitySpec → CodePlan、真实代码与 SourceMap

**Files:**
- Create: `packages/codegen/src/production.ts`
- Modify: `packages/codegen/src/index.ts`
- Test: `packages/codegen/src/production.test.ts`

- [x] **Step 1: 写失败测试**

```ts
it("generates real page files with stable node ids and source locators", () => {
  const output = generateProductionPage(spec, profile, mappings);
  expect(output.plan.files.map((file) => file.path)).toContain("src/pages/CampaignPage.tsx");
  expect(output.files["src/pages/CampaignPage.tsx"]).toContain('data-d2c-node-id="hero"');
  expect(output.sourceMap.locators.find((item) => item.nodeId === "hero")?.file)
    .toBe("src/pages/CampaignPage.tsx");
});

it("rejects code plans outside allowed write globs", () => {
  expect(() => validateCodePlan(unsafePlan, profile)).toThrow(/allowedWriteGlobs/);
});
```

- [x] **Step 2: 验证 RED**

Run: `pnpm --filter @d2c/codegen test -- production.test.ts`
Expected: FAIL，缺少生产生成 API。

- [x] **Step 3: 实现最小生成器**

实现：

```ts
planProductionFiles(spec, profile, mappings): CodePlan
generateProductionPage(spec, profile, mappings): GeneratedProductionOutput
validateCodePlan(plan, profile): void
```

生成一个 Route Page、局部 Section Components、CSS Module、Asset Copy Plan 和 `d2c-source-map.json`。结构节点使用 Flow/Flex/Grid，只有标记为 decoration 的节点允许无惩罚 Absolute。

- [x] **Step 4: 验证 GREEN 并提交**

Run: `pnpm --filter @d2c/codegen test && pnpm --filter @d2c/codegen typecheck`
Expected: PASS。

```bash
git add packages/codegen
git commit -m "feat(codegen): 生成真实活动页代码与源码映射"
```

## Task 4：Artifact Store 与隔离 Workspace

**Files:**
- Create: `packages/production-runtime/package.json`
- Create: `packages/production-runtime/tsconfig.json`
- Create: `packages/production-runtime/src/artifacts.ts`
- Create: `packages/production-runtime/src/workspace.ts`
- Create: `packages/production-runtime/src/index.ts`
- Test: `packages/production-runtime/src/artifacts.test.ts`
- Test: `packages/production-runtime/src/workspace.test.ts`

- [x] **Step 1: 写失败测试**

```ts
it("writes immutable versioned artifacts under one run directory", async () => {
  const store = await FileArtifactStore.create(tempRoot, "run-1");
  const first = await store.writeJson("spec", "activity-spec", { version: 1 });
  const second = await store.writeJson("spec", "activity-spec", { version: 2 });
  expect(first.path).not.toBe(second.path);
});

it("refuses writes outside allowed globs and the workspace root", async () => {
  await expect(workspace.writeFile("../secret", "x")).rejects.toThrow(/workspace/);
});
```

- [x] **Step 2: 验证 RED**

Run: `pnpm --filter @d2c/production-runtime test`
Expected: FAIL，workspace package/API 不存在。

- [x] **Step 3: 实现 Artifact 与 Workspace**

`FileArtifactStore` 使用 `fs.open(..., "wx")` 保证不可覆盖；`RunWorkspace` 通过 `realpath` 和 Profile globs 校验写入路径，只应用 CodePlan 中声明的文件。

- [x] **Step 4: 验证 GREEN 并提交**

Run: `pnpm --filter @d2c/production-runtime test && pnpm --filter @d2c/production-runtime typecheck`
Expected: PASS。

```bash
git add packages/production-runtime pnpm-lock.yaml
git commit -m "feat(runtime): 新增运行产物与隔离工作区"
```

## Task 5：真实命令执行、Build 与 Playwright Render

**Files:**
- Create: `packages/production-runtime/src/command.ts`
- Create: `packages/production-runtime/src/render.ts`
- Test: `packages/production-runtime/src/command.test.ts`
- Test: `packages/production-runtime/src/render.test.ts`

- [x] **Step 1: 写失败测试**

```ts
it("captures exit code, duration and bounded output", async () => {
  const result = await runAllowedCommand(process.execPath, ["-e", "console.log('ok')"], options);
  expect(result).toMatchObject({ exitCode: 0, stdout: "ok\n" });
});

it("collects screenshot and geometry for stable node ids", async () => {
  const result = await renderPage({ url, outputDir, viewports: [{ name: "desktop", width: 1440, height: 900 }] });
  expect(result.viewports[0]?.nodes.hero?.width).toBeGreaterThan(0);
});
```

- [x] **Step 2: 验证 RED**

Run: `pnpm --filter @d2c/production-runtime test -- command.test.ts render.test.ts`
Expected: FAIL。

- [x] **Step 3: 实现命令与渲染**

- 使用 `spawn(executable, args, { shell: false })`。
- 命令必须与 Profile 数组精确匹配。
- 超时终止进程树并返回 `timedOut`。
- Playwright 固定 viewport/DPR，关闭动画，等待字体、图片和 ready marker。
- 采集 screenshot、console/runtime errors 和 `[data-d2c-node-id]` computed geometry。

- [x] **Step 4: 验证 GREEN 并提交**

Run: `pnpm --filter @d2c/production-runtime test && pnpm --filter @d2c/production-runtime typecheck`
Expected: PASS。

```bash
git add packages/production-runtime pnpm-lock.yaml
git commit -m "feat(runtime): 接入真实构建命令与页面渲染"
```

## Task 6：客观 Eval

**Files:**
- Create: `packages/evaluator/src/production.ts`
- Modify: `packages/evaluator/src/index.ts`
- Modify: `packages/evaluator/package.json`
- Test: `packages/evaluator/src/production.test.ts`

- [x] **Step 1: 写失败测试**

```ts
it("reports geometry, image, text, asset and engineering metrics from artifacts", async () => {
  const report = await evaluateProductionRun(input);
  expect(report.metrics.visual.layoutGeometry).toBeLessThan(100);
  expect(report.metrics.engineering.structuralAbsoluteRatio).toBe(0);
  expect(report.violations[0]).toMatchObject({ type: "layout", nodeIds: ["hero"] });
});

it("never passes when build failed", async () => {
  const report = await evaluateProductionRun({ ...input, build: { exitCode: 1 } });
  expect(report.outcome).toBe("failed");
  expect(report.violations.some((item) => item.severity === "P0")).toBe(true);
});
```

- [x] **Step 2: 验证 RED**

Run: `pnpm --filter @d2c/evaluator test -- production.test.ts`
Expected: FAIL。

- [x] **Step 3: 实现指标**

- looks-same：Diff ratio、bounds、clusters。
- Jimp：asset pHash distance。
- OCR Adapter：Tesseract.js，可注入测试实现。
- DOM：BBox、对齐、overflow、字体和 computed style。
- Code：组件复用、Token、结构 absolute、硬编码和复杂度。
- 总分 `0.70 visual + 0.30 engineering`，硬门槛先于分数。

- [x] **Step 4: 验证 GREEN 并提交**

Run: `pnpm --filter @d2c/evaluator test && pnpm --filter @d2c/evaluator typecheck`
Expected: PASS。

```bash
git add packages/evaluator pnpm-lock.yaml
git commit -m "feat(evaluator): 新增活动页客观评测"
```

## Task 7：Error Attribution 与 Targeted Repair

**Files:**
- Create: `packages/evaluator/src/attribution.ts`
- Create: `packages/production-runtime/src/repair.ts`
- Test: `packages/evaluator/src/attribution.test.ts`
- Test: `packages/production-runtime/src/repair.test.ts`

- [x] **Step 1: 写失败测试**

```ts
it("attributes a shared translation to the parent layout source", () => {
  const violations = attributeDiffClusters(clusters, geometry, sourceMap);
  expect(violations[0]).toMatchObject({ type: "layout", nodeIds: ["hero"], sourceLocators: [{ file: "src/pages/CampaignPage.tsx" }] });
});

it("rejects patches touching more than five or undeclared files", () => {
  expect(() => validatePatchPlan(plan, profile, sourceMap)).toThrow(/allowedFiles/);
});
```

- [x] **Step 2: 验证 RED**

Run: `pnpm --filter @d2c/evaluator test -- attribution.test.ts && pnpm --filter @d2c/production-runtime test -- repair.test.ts`
Expected: FAIL。

- [x] **Step 3: 实现归因和补丁**

- Diff Cluster 按 IoU/距离合并。
- 与 DOM BBox、z-index、SourceMap 关联。
- 分类 build/layout/style/asset/text/component/responsive。
- PatchPlan 仅允许 Spec JSON、TSX AST、CSS declaration 和 asset replacement。
- 使用 ts-morph 修改 TSX，CSS patch 使用显式 selector/property。
- 每轮保留 rollback Artifact，最多 3 轮，连续两轮提升小于 1 分停止。

- [x] **Step 4: 验证 GREEN 并提交**

Run: `pnpm --filter @d2c/evaluator test && pnpm --filter @d2c/production-runtime test`
Expected: PASS。

```bash
git add packages/evaluator packages/production-runtime pnpm-lock.yaml
git commit -m "feat(repair): 实现区域归因与定向修复"
```

## Task 8：生产 Orchestrator

**Files:**
- Create: `packages/orchestrator/src/production.ts`
- Modify: `packages/orchestrator/src/index.ts`
- Test: `packages/orchestrator/src/production.test.ts`

- [x] **Step 1: 写失败集成测试**

```ts
it("uses real artifacts for plan, build, render, eval and repair", async () => {
  const events = await collect(runProductionWorkflow(input, adapters));
  expect(events.map((event) => event.state)).toEqual(expect.arrayContaining([
    "PROJECT_INSPECTED", "SPEC_VALIDATED", "TYPECHECKED", "RENDERED", "ATTRIBUTED",
  ]));
  expect(events.find((event) => event.state === "BUILT")?.data?.artifactId).toBeTruthy();
  expect(events.at(-1)?.state).toMatch(/COMPLETED|NEEDS_REVIEW/);
});
```

- [x] **Step 2: 验证 RED**

Run: `pnpm --filter @d2c/orchestrator test -- production.test.ts`
Expected: FAIL。

- [x] **Step 3: 实现状态机**

保持 `runReplayWorkflow` 不变，新增 `runProductionWorkflow`，依赖注入 Inspector/Generator/Workspace/Renderer/Evaluator/Repairer；每个状态只能来自 Adapter 的真实结果和 Artifact ID。

- [x] **Step 4: 验证 GREEN 并提交**

Run: `pnpm --filter @d2c/orchestrator test && pnpm --filter @d2c/orchestrator typecheck`
Expected: PASS。

```bash
git add packages/orchestrator
git commit -m "feat(orchestrator): 打通活动页生产工作流"
```

## Task 9：截图、PRD 与资产 Evidence

**Files:**
- Create: `apps/server/src/vision-production.ts`
- Modify: `apps/server/src/vision.ts`
- Test: `apps/server/src/vision-production.test.ts`

- [x] **Step 1: 写失败测试**

```ts
it("merges PRD facts above OCR and keeps model uncertainty", async () => {
  const result = await buildActivitySpecDraft(input, fakeVisionProvider);
  expect(result.spec.nodes.find((node) => node.id === "hero-title")?.content?.text).toBe("PRD 标题");
  expect(result.spec.unresolved).toContainEqual(expect.objectContaining({ reason: expect.stringContaining("conflict") }));
});
```

- [x] **Step 2: 验证 RED**

Run: `pnpm --filter @d2c/server test -- vision-production.test.ts`
Expected: FAIL。

- [x] **Step 3: 实现视觉适配器**

复用现有 Vision Provider 连接，Prompt 输出 ActivitySpec Draft；增加 OCR/asset/provider Evidence 合并、Zod 校验和一次结构化重试。支持可选 `D2C_VISUAL_SIDECAR_URL`，存在时调用 screenshot-to-code 兼容 Sidecar，否则走现有模型 Provider。

- [x] **Step 4: 验证 GREEN 并提交**

Run: `pnpm --filter @d2c/server test -- vision-production.test.ts vision.test.ts`
Expected: PASS。

```bash
git add apps/server/src/vision-production.ts apps/server/src/vision-production.test.ts apps/server/src/vision.ts
git commit -m "feat(vision): 生成带证据的活动页结构稿"
```

## Task 10：生产 Server API 与持久化 Run

**Files:**
- Create: `apps/server/src/production.ts`
- Modify: `apps/server/src/app.ts`
- Test: `apps/server/src/production.test.ts`
- Test: `apps/server/src/app.test.ts`

- [x] **Step 1: 写失败 API 测试**

```ts
it("creates a production run and returns artifact-backed status", async () => {
  const created = await app.inject({ method: "POST", url: "/api/production/runs", payload });
  expect(created.statusCode).toBe(202);
  const detail = await app.inject({ method: "GET", url: `/api/production/runs/${created.json().runId}` });
  expect(detail.json().mode).toBe("production");
});

it("rejects target paths outside configured roots", async () => {
  const response = await app.inject({ method: "POST", url: "/api/production/runs", payload: unsafe });
  expect(response.statusCode).toBe(400);
});
```

- [x] **Step 2: 验证 RED**

Run: `pnpm --filter @d2c/server test -- production.test.ts app.test.ts`
Expected: FAIL/404。

- [x] **Step 3: 实现 API**

```text
POST /api/production/runs
GET  /api/production/runs/:id
GET  /api/production/runs/:id/events
POST /api/production/runs/:id/confirm-mapping
POST /api/production/runs/:id/edit
POST /api/production/runs/:id/repair
GET  /api/production/runs/:id/artifacts/:artifactId
```

Run 元数据落在 `runs/<id>/run.json`，启动时可重载；事件使用现有 SSE 模式。

- [x] **Step 4: 验证 GREEN 并提交**

Run: `pnpm --filter @d2c/server test && pnpm --filter @d2c/server typecheck`
Expected: PASS。

```bash
git add apps/server packages/production-runtime
git commit -m "feat(server): 提供活动页生产运行接口"
```

## Task 11：Puck 原型与 Figma 导出

**Files:**
- Create: `apps/web/src/components/PrototypeEditor.tsx`
- Create: `apps/web/src/components/PrototypeEditor.test.tsx`
- Create: `packages/figma-patcher/src/export.ts`
- Create: `packages/figma-patcher/src/export.test.ts`
- Modify: `packages/figma-patcher/src/index.ts`
- Modify: `apps/web/package.json`

- [x] **Step 1: 写失败测试**

```tsx
it("converts ActivitySpec edits to typed EditOps", async () => {
  render(<PrototypeEditor spec={spec} onEdit={onEdit} />);
  await userEvent.clear(screen.getByLabelText("hero-title 文本"));
  await userEvent.type(screen.getByLabelText("hero-title 文本"), "新标题");
  expect(onEdit).toHaveBeenCalledWith(expect.arrayContaining([
    expect.objectContaining({ nodeId: "hero-title", kind: "set-content" }),
  ]));
});
```

```ts
it("exports editable Figma nodes with stable plugin data", () => {
  const bundle = buildFigmaImportBundle(spec, renderedDocument);
  expect(bundle.nodes[0]?.pluginData.d2cNodeId).toBe("page");
});
```

- [x] **Step 2: 验证 RED**

Run: `pnpm --filter @d2c/web test -- PrototypeEditor.test.tsx && pnpm --filter @d2c/figma-patcher test -- export.test.ts`
Expected: FAIL。

- [x] **Step 3: 实现适配器**

- 引入 `@measured/puck`。
- ActivitySpec role → Puck Config，实例 → Puck Data。
- Puck change → 类型化 EditOps。
- Figma 导出生成 html-to-figma 兼容节点 JSON、assets 和 manifest；保留 `d2cNodeId`。

- [x] **Step 4: 验证 GREEN 并提交**

Run: `pnpm --filter @d2c/web test -- PrototypeEditor.test.tsx && pnpm --filter @d2c/figma-patcher test && pnpm typecheck`
Expected: PASS。

```bash
git add apps/web packages/figma-patcher pnpm-lock.yaml
git commit -m "feat(design): 接入可编辑原型与 Figma 导出"
```

## Task 12：生产 Workbench UI

**Files:**
- Create: `apps/web/src/lib/production-api.ts`
- Create: `apps/web/src/lib/production-api.test.ts`
- Create: `apps/web/src/components/ProductionWorkbench.tsx`
- Create: `apps/web/src/components/ProductionWorkbench.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`

- [x] **Step 1: 写失败测试**

```tsx
it("shows real build artifacts, diff regions and targeted patch scope", async () => {
  render(<ProductionWorkbench />);
  await userEvent.click(screen.getByRole("button", { name: "运行生产闭环" }));
  expect(await screen.findByText("真实构建通过")).toBeInTheDocument();
  await userEvent.click(screen.getByText("layout_error · hero"));
  expect(screen.getByText("src/pages/CampaignPage.tsx")).toBeInTheDocument();
  expect(screen.getByText("仅修改 2 个文件")).toBeInTheDocument();
});
```

- [x] **Step 2: 验证 RED**

Run: `pnpm --filter @d2c/web test -- ProductionWorkbench.test.tsx`
Expected: FAIL。

- [x] **Step 3: 实现生产页面**

提供输入、ActivitySpec/证据、Puck/Live Preview、Desktop/Mobile、Diff Overlay、Violation、Source Locator、Patch Timeline、组件候选和最终交付。保留现有 Demo/I2D 页，新增“活动页生产”模式，不用一次性重写 App。

- [x] **Step 4: 验证 GREEN 并提交**

Run: `pnpm --filter @d2c/web test && pnpm --filter @d2c/web typecheck`
Expected: PASS。

```bash
git add apps/web
git commit -m "feat(web): 新增活动页生产工作台"
```

## Task 13：黄金 Fixture 与端到端闭环

**Files:**
- Create: `examples/activity-pages/campaign/reference.svg`
- Create: `examples/activity-pages/campaign/prd.md`
- Create: `examples/activity-pages/campaign/activity-spec.json`
- Create: `examples/activity-pages/campaign/target-profile.json`
- Create: `examples/activity-target/`
- Create: `tests/e2e/production.spec.ts`
- Modify: `README.md`
- Modify: `docs/demo-script.md`

- [x] **Step 1: 写失败 E2E**

```ts
test("activity page production loop builds, evaluates, attributes and repairs", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "活动页生产" }).click();
  await page.getByRole("button", { name: "载入黄金样例" }).click();
  await page.getByRole("button", { name: "运行生产闭环" }).click();
  await expect(page.getByText("COMPLETED")).toBeVisible();
  await expect(page.getByTestId("production-final-score")).toHaveText(/9\d/);
  await expect(page.getByText(/局部修复/)).toBeVisible();
});
```

- [x] **Step 2: 验证 RED**

Run: `pnpm e2e -- production.spec.ts`
Expected: FAIL，因为黄金样例和生产模式未完成。

- [x] **Step 3: 完成 Fixture 与文档**

黄金样例包含一个可修复的 Hero 间距错误，首次评测产生 `layout` Violation，Repair 只修改 Campaign CSS，复评提升并通过。README 清楚区分 Replay、Vision 和 Production 三种模式及其外部依赖。

- [x] **Step 4: 完整验证**

Run:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm e2e -- production.spec.ts
```

Expected: 全部 exit 0；生产 E2E 显示真实 Artifact 和局部修复。

- [x] **Step 5: 最终提交**

```bash
git add examples tests README.md docs/demo-script.md
git commit -m "test: 增加活动页生产闭环黄金样例"
```

## 自检清单

- [x] 设计文档第 4–26 节均能映射到 Task 1–13。
- [x] 生产路径不存在 Fixture 常量评分和伪造 Build 事件。
- [x] Replay 模式保持兼容且在 UI 中明确标记。
- [x] 所有新行为遵循 RED → GREEN → REFACTOR。
- [x] 所有写入和命令都经过 Profile/Workspace 边界校验。
- [x] Puck、评测和 Figma 输出共用 ActivitySpec/Node ID。
- [x] 开源依赖锁版本并保留许可证说明。
