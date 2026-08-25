# 中文浅色全 Mock 演示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将工作台改成中文优先的白色界面，并让默认完整演示在没有后端时仍能稳定完成 12 步 Agent 流程与 72→94 评测修复闭环。

**Architecture:** 新增浏览器端 Mock Run Adapter，复用现有 `RunDetail`、`TraceEvent`、`ComponentMapping` 和 `EvaluationReport` 协议。默认演示直接消费本地异步事件；真实 Bundle 上传继续使用现有 API/SSE，失败后通过显式按钮降级到同一 Mock Adapter。

**Tech Stack:** React、TypeScript、Vitest、Testing Library、Playwright、CSS

---

## 文件结构

- `apps/web/src/lib/mock-run.ts`：完整 Mock Run、组件映射、两轮评测、生成代码和可取消事件播放器。
- `apps/web/src/lib/mock-run.test.ts`：验证 12 步顺序、72→94 和取消能力。
- `apps/web/src/App.tsx`：中文界面、Mock-first 启动与上传失败降级。
- `apps/web/src/App.test.tsx`：无后端完整流程及上传失败降级行为。
- `apps/web/src/styles.css`：白色主题及状态色。
- `playwright.config.ts`：E2E 仅启动 Web，证明默认演示与后端无关。
- `tests/e2e/demo.spec.ts`：中文流程和白色主题浏览器验收。
- `README.md`、`docs/demo-script.md`：更新运行方式与演示话术。

### Task 1: 建立浏览器端 Mock Run Adapter

**Files:**
- Create: `apps/web/src/lib/mock-run.test.ts`
- Create: `apps/web/src/lib/mock-run.ts`

- [ ] **Step 1: 写失败测试**

测试使用 `vi.useFakeTimers()` 调用 `createMockRun()` 与 `playMockWorkflow()`，收集事件并断言：Run 名称为“动感商品网格”、事件数为 12、状态包含两次 `EVALUATED`、评分为 `[72, 94]`、完成事件含 `scoreDelta: 22`。

```ts
it("在浏览器内播放完整的十二步修复闭环", async () => {
  vi.useFakeTimers();
  const received: TraceEvent[] = [];
  const playback = playMockWorkflow((event) => received.push(event), { delayMs: 10 });
  await vi.runAllTimersAsync();
  await playback.done;
  expect(received).toHaveLength(12);
  expect(received.filter((event) => event.state === "EVALUATED")
    .map((event) => (event.data?.evaluation as EvaluationReport).overall)).toEqual([72, 94]);
  expect(received.at(-1)?.data?.scoreDelta).toBe(22);
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter @d2c/web test -- src/lib/mock-run.test.ts`

Expected: FAIL，提示 `./mock-run` 不存在。

- [ ] **Step 3: 实现最小 Mock Adapter**

导出：

```ts
export function createMockRun(): RunDetail;
export function createMockEvents(runId: string): TraceEvent[];
export function playMockWorkflow(
  onEvent: (event: TraceEvent) => void,
  options?: { delayMs?: number },
): { cancel: () => void; done: Promise<void> };
```

事件依次为：资产包已导入、结构校验完成、UISpec 编译完成、SDS 资产索引完成、组件映射完成、代码计划完成、React 代码生成完成、构建通过、首次评测 72、自动修复、复评 94、交付完成。组件映射和评测数据沿用共享协议。

- [ ] **Step 4: 运行测试与类型检查**

Run: `pnpm --filter @d2c/web test -- src/lib/mock-run.test.ts && pnpm --filter @d2c/web typecheck`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/lib/mock-run.ts apps/web/src/lib/mock-run.test.ts
git commit -m "feat: 增加浏览器端完整Mock工作流"
```

### Task 2: 默认演示改为 Mock-first 并增加降级入口

**Files:**
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: 写无后端失败测试**

移除对 `startDemoRun`、`getRun` 和 `subscribeToRun` 的成功 Mock，只保留 `uploadBundle`。点击“运行完整演示”，使用 fake timers 推进时间，断言“设计输入”“Agent 执行轨迹”“代码交付”、`ProductCard`、72、94、`+22` 和“已完成”。

- [ ] **Step 2: 写上传失败降级测试**

让 `uploadBundle()` 抛出“服务不可用”，上传文件后断言出现“上传失败”和“使用演示数据继续”；点击降级按钮并推进时间，最终分数为 94。

- [ ] **Step 3: 运行并确认两条测试失败**

Run: `pnpm --filter @d2c/web test -- src/App.test.tsx`

Expected: FAIL，找不到中文按钮或仍调用服务端 Demo API。

- [ ] **Step 4: 实现 Mock-first 和显式降级**

在 `App` 中增加 `startMockDemo()`，先取消 SSE 或旧 Playback，再调用 `createMockRun()` 和 `playMockWorkflow()`。默认按钮直接调用它。上传仍调用真实 `connect(uploadBundle(file))`；失败时保存中文错误与文件名，并显示调用 `startMockDemo()` 的降级按钮。

- [ ] **Step 5: 完成中文化**

将界面普通文案替换为：

- `Design Source` → `设计输入`
- `Agent Trace` → `Agent 执行轨迹`
- `Delivery` → `代码交付`
- `Run demo` → `运行完整演示`
- `Upload bundle` → `上传 Figma 资产包`
- `Replay` → `重新演示`
- `Download report` → `下载报告`
- `Ready for review` → `已达到评审标准`
- `Awaiting evaluation` → `等待评测`

事件标题、状态显示、空状态、节点统计、指标和页脚同样中文化，必要技术词保持英文。

- [ ] **Step 6: 运行测试、类型检查和构建**

Run: `pnpm --filter @d2c/web test && pnpm --filter @d2c/web typecheck && pnpm --filter @d2c/web build`

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add apps/web/src/App.tsx apps/web/src/App.test.tsx
git commit -m "feat: 默认使用中文Mock完整演示"
```

### Task 3: 改为白色视觉主题

**Files:**
- Modify: `apps/web/src/styles.css`
- Modify: `tests/e2e/demo.spec.ts`
- Modify: `playwright.config.ts`

- [ ] **Step 1: 写浏览器失败验收**

将 E2E 按钮与文案改成中文，并断言：

```ts
await expect(page.locator("body")).toHaveCSS("background-color", "rgb(246, 247, 243)");
await page.getByRole("button", { name: "运行完整演示" }).click();
await expect(page.getByTestId("final-score")).toHaveText("94");
await expect(page.getByText("已完成").first()).toBeVisible();
```

Playwright `webServer` 只保留 Vite 服务，证明默认演示不依赖 Fastify。

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm e2e`

Expected: FAIL，背景仍为深色或中文控件不存在。

- [ ] **Step 3: 实现白色主题**

将页面主背景设为 `#f6f7f3`，工作区卡片设为 `#ffffff`，边框设为 `#dfe2db`，正文设为 `#171a16`，次要文字设为 `#697067`。保留 `#9bd500` 绿色和 `#f05a2a` 橙色作为运行、成功和修复强调。生成页面预览保持自身设计颜色。

- [ ] **Step 4: 运行 E2E 与 Web 构建**

Run: `pnpm e2e && pnpm --filter @d2c/web build`

Expected: PASS，E2E 只启动 Web。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/styles.css playwright.config.ts tests/e2e/demo.spec.ts
git commit -m "style: 改为白色中文演示工作台"
```

### Task 4: 更新文档、截图并完成验证

**Files:**
- Modify: `README.md`
- Modify: `docs/demo-script.md`
- Modify: `docs/workbench-completed.png`

- [ ] **Step 1: 更新说明**

README 明确“运行完整演示”完全在浏览器本地执行，`pnpm --filter @d2c/web dev` 即可演示；`pnpm dev` 用于同时验证真实上传。Demo 脚本改用中文界面名称，并说明上传失败时的显式 Mock 降级。

- [ ] **Step 2: 浏览器视觉验收**

使用 gstack `/browse` 打开 `http://127.0.0.1:5173`，设置 1440×1100，运行完整演示，检查中文覆盖、浅色对比度、12 步 Trace、72→94、组件证据和控制台错误。保存完成态到 `docs/workbench-completed.png`。

- [ ] **Step 3: 全量验证**

Run: `pnpm typecheck && pnpm test && pnpm build && pnpm e2e && git diff --check`

Expected: 全部退出码为 0。

- [ ] **Step 4: 提交并推送**

```bash
git add README.md docs/demo-script.md docs/workbench-completed.png
git commit -m "docs: 更新中文浅色演示说明"
git push -u origin codex/chinese-light-mock-demo
```
