# D2C Agent Workbench：面试 Demo 脚本

> 两个版本：**3 分钟版**（重点亮点串讲） / **10 分钟版**（完整功能覆盖 + JD 映射）。
> 现场默认从 **3 分钟版**开始；面试官追问时按 **10 分钟版** 的对应章节展开。

---

## 3 分钟版（先讲亮点）

### 开场 20 秒

“这个 Demo 解决的不是截图转 HTML，而是**如何把 Figma 的设计意图编译成可维护、可评测、可进入研发流程的代码**。我会演示四个亮点：真实评测闭环、可观察 Agent 工具调用、对话式画布编辑、以及基于真实 LLM 的可降级 Provider。”

让面试官先看到三栏：「设计输入」「Agent 执行轨迹」「代码交付」。

### 亮点 1：真实评测闭环 40 秒

点击 **运行完整演示**。右侧看 72 → 94 的过程：

- 草稿是 **真实计算产物**（从 styleRefs / tokensLayer 推导），不是字面量
- Eval Agent 独立上下文评分：geometry / componentReuse / tokenCompliance / visualFidelity / semanticStructure / codeQuality 六维
- Repair 只改 3 项 violation，复评 +22 分到 94
- 切 fixture 到「表单页」→ 跑一次 → 看到 52.1 → 91.9 完全不同的分数；证明非硬编码

### 亮点 2：可观察工具调用 30 秒

中栏「Agent 执行轨迹」逐事件展开：

- 每个状态都带 `toolCalls`（LOCAL TOOL / LLM 徽章）
- 真实工具名：`figma.validate` / `ui.compileSpec` / `matcher.mapComponents` / `codegen.generate{draft,final}` / `evaluator.scanArtifact` / `repair.planOps`
- trace 不是字符串拼接，是 Zod 协议化的 Artifact

### 亮点 3：对话式画布编辑 30 秒

切到 I2D → 自动播放 → ChatPanel 输入「把第二张卡片换成 lime」→ 发送：

- 画布实时刷新（card-2 className 从 `coral` 变 `lime`）
- trace 实时追加 `CANVAS_EDITED` 事件 + `toolCalls: [{name: "canvas.parseIntent", provider: "local"}]`
- 切到「设置面板」改成 LLM → 看 toolCalls 变 `llm.interpretIntent` + 实际请求 X-LLM-Key 头
- 拔掉 key 重发 → 自动降级规则解析 + ChatPanel 提示「LLM 不可达，已自动降级」

### 亮点 4：双 fixture + 一致性守护 20 秒

- 顶栏切 fixture 不需要重启；同一渲染器吃不同结构（`SpecRenderer` 按 semanticRole 派发）
- 浏览器内本地真实执行 vs server SSE 路径，`scripts/consistency.test.ts` 钉两路逐字段一致

### 收尾 20 秒

“这个项目回挂了 JD 的 6 个职责 + 8 个要求。**[3 分钟版结束，10 分钟版从下面继续]**

---

## 10 分钟版

### 0. 开场 30 秒

“这个 Demo 解决的不是截图转 HTML，而是如何把 Figma 里的设计意图编译成可维护、可评测、能进入研发流程的代码。重点有四个：结构化输入、企业资产复用、可观察的 Agent 工作流，以及独立评测驱动的修复闭环。”

先打开工作台，但不要立刻点击运行。让面试官看到三栏：「设计输入」「Agent 执行轨迹」「代码交付」。

### 1. 输入不是一张图：1 分钟

指向左栏并说明：

- 输入是离线 Figma Bundle，不依赖现场登录或 MCP 权限。
- Bundle 包含 Node Tree、Frame、Auto Layout、Hug / Fill / Fixed、组件实例、变量绑定和 SVG Preview。
- 截图只用于视觉对照；布局、语义和 Token 来自结构数据。
- 导入器会阻止路径穿越、绝对路径和过大的压缩包，并通过 Zod Schema 校验协议。

一句总结：“多模态在这里不是只看像素，而是融合视觉预览与 Figma 结构。”

### 2. 点击「运行完整演示」：1 分钟

点击 **运行完整演示**，让中间执行轨迹开始流动。**默认演示完全在浏览器端执行确定性管线（与上传到 server 跑同一条 runReplayWorkflow），不依赖后端或网络**。

解释状态机：

```text
UPLOADED → VALIDATED → NORMALIZED → ASSETS_INDEXED
→ COMPONENTS_MAPPED → CODE_PLANNED → GENERATED → BUILT
→ EVALUATED → REPAIRING → BUILT → EVALUATED → COMPLETED
```

强调每一步都输出类型化 Event + toolCalls（不是把所有上下文塞进一次 Prompt）。Mock / 真实两条路径使用相同协议；上传真实 Bundle 时由服务端通过 SSE 推送，本地演示由浏览器内确定性管线播放。同一条 Trace 可以回放、定位失败和复现结果。

### 3. UISpec 与上下文工程：1 分 30 秒

说明 UISpec 是统一中间表示：

- Figma Importer 只负责解析外部结构。
- UISpec Compiler 把横向 / 纵向 Auto Layout 变成 row / column / grid 语义，保留 Sizing、约束和 Token 引用。
- Build Agent、Eval Agent、对话式编辑都消费同一 UISpec，避免各自重新理解设计稿。
- 上下文按任务裁剪：组件匹配只获得 UISpec 节点、候选组件 API 和相关代码示例，不读取整个仓库。

一句总结：“UISpec 是这条链路的上下文压缩层和可编辑语义层。”

### 4. 企业组件与 Design Token：1 分 30 秒

指向中栏「组件匹配证据」：

- `Product Card / Default` 被映射到 `ProductCard`，并展示 import path、置信度和证据。
- 匹配不是让模型在仓库里盲猜，而是先由 SDS Registry 召回候选，再由 Agent 在小范围内决策。
- 高置信度自动采用，中置信度标记 Review，低置信度请求人工确认。
- 颜色、间距、圆角优先生成 Token 引用，不写任意魔法数字。

### 5. Build / Eval 双 Agent + 真实评测闭环：2 分钟

指向右栏 72 分到 94 分的过程：

- Build Agent 负责代码计划、生成、构建和 Repair。
- Eval Agent 使用隔离上下文，独立检查六维指标。
- **首轮结果是 72，从产物计算得到**（spacing 字面量 + token 未声明 + geometry 漂移），不是字面量。
- **Violation 3 项是真实产物扫描的产物**（不是字面量清单），测试钉死 id 防回归。
- Repair 只修改对应问题（`tokenize` / `restore-value` / `define-token` / `snap-to-declared` 四类操作），再做构建和复评，最终达到 94，提升 22 分。
- 通过门槛是总分至少 90 且没有 P0；不是让 Build Agent 自己宣布成功。

切到「代码 Diff」页签：
- 真实 LCS 行 diff tokens.css（草稿 vs 终稿）
- 配合 `repairPatches` 显示修复操作摘要

一句总结：“多 Agent 的价值不在角色数量，而在职责隔离、可验证反馈和受控修复。”

### 6. 双 fixture 泛化：1 分钟

切到「表单页」fixture：

- 顶栏切换 fixture 不重启演示
- 自动播放 → 看到 52.1 → 91.9 不同的分数
- form-page 故意含未映射组件（Checkbox）+ 漂移 gap；eval 报告里的 violation id 也与 product-grid 完全不同
- 证明泛化：同一渲染器吃不同结构 + 同一管线跑不同产物

### 7. 对话式画布编辑 + LLM Provider：1 分 30 秒

切到 I2D → 自动播放 → ChatPanel 输入「把第二张卡片换成 lime」→ 发送：

- 画布实时刷新（card-2 className 切换）
- trace 实时追加 `CANVAS_EDITED` 事件 + toolCalls
- **默认 Provider = 规则解析**（演示零风险，离线可跑）
- 切到「设置面板」改成 LLM（MiniMax / Anthropic 兼容端点）→ 填 key → 再次发送
- 看 toolCalls 变 `llm.interpretIntent` + 真实 POST /api/canvas/interpret（key 走 X-LLM-Key 请求头）
- **拔掉 key / 断网重发**：自动降级规则解析 + ChatPanel 提示「LLM 不可达」+ toolCalls `fallback:true`

### 8. 可交付性：1 分钟

指向右栏「页面预览」、生成代码和「下载报告」：

- 页面不是最终截图，而是 React / TypeScript 交付物。
- 报告包含完整 Run、Trace、组件映射证据、两轮 Eval 与分数变化、token compliance、violation id、toolCalls。
- 研发可以审查生成代码和 Diff，设计师可以追溯节点、Token 与视觉问题。
- 现场断网时浏览器内确定性管线保证演示稳定；接 LLM 走同一份事件与 Artifact 协议。

如果要展示真实上传，可以选择 `product-grid.zip`。服务不可用时，界面会明确提示「上传失败」，再由你点击「使用演示数据继续」；系统不会把失败的真实上传伪装成成功。

### 9. 主动说明当前边界：45 秒

“这版把最不稳定的外部依赖放到了 Adapter 后面：默认使用浏览器内确定性管线，真实上传使用结构化离线 Bundle，LLM 默认规则解析（key 不进仓库、不进日志、不进下载报告）。它不是声称已经解决任意仓库生成；下一阶段会依次替换为真实 Asset Indexer、Codex Adapter、Figma Exporter 和 Playwright Geometry / Visual Eval。核心协议和工作台无需重写。”

### 10. 收尾 + JD 映射：45 秒

“这个项目覆盖了 JD 的六个重点（Agent 架构与工作流 / Figma 多模态 UI 理解 / D2C 出码 / 企业设计系统检索复用 / 对话式画布编辑 / 评测反馈闭环）和八个要求（LLM 框架 / Figma 工具 / 前端工程 / UI 设计理解 / 评测指标 / 真实场景落地 / 文档沟通 / 工程能力）。具体每条 JD 对应哪个代码点，见 `docs/jd-mapping.md`。”

---

## 常见追问

### 为什么不用一个超长 Prompt？

因为输入解析、组件检索、生成和评测需要不同权限、上下文与失败处理。协议化 Artifact 能减少上下文污染，并支持重试、回放和局部修复。每个 trace event 都带 `toolCalls`，便于事后审计与对齐 LLM 行为。

### 为什么先不用 Figma MCP？

MCP 是 Transport，不是核心业务能力。离线 Bundle 更容易控制权限、版本和面试稳定性；未来增加 `FigmaMcpAdapter` 时不需要修改 UISpec 之后的链路。LLM 同理：`@d2c/canvas-ops` 是 provider-agnostic 的，规则解析默认 + LLM 通过 `POST /api/canvas/interpret` 接入，未来加 MCP / Bedrock / Anthropic SDK 都只改 `apps/server/src/llm.ts`。

### 如何接企业代码仓库？

扫描 export、Props、Storybook、Code Connect、Token 和历史用法，生成可增量更新的结构化索引。检索阶段只提供最相关候选和证据，再让 Agent 决策。当前 6 个 SDS 组件已经在 `packages/component-matcher/src/registry.ts` 内显式列出，便于替换 / 扩展。

### 如何防止评测刷分？

Build 和 Eval 隔离上下文；关键门槛由 TypeScript、Build、页面加载和关键节点检测决定；视觉模型只做问题归因，不单独决定通过。所有 violation id 都是草稿产物的 DFS 序 fold，由测试钉死；改 fixture 不会让分数巧合不变。

### LLM 真的接进来了吗？key 怎么保管？

接了（`apps/server/src/llm.ts`）。key 只存浏览器 localStorage（设置面板），走 X-LLM-Key 请求头到本地 Fastify 代理，代理再转发到 MiniMax。仓库任何文件不含 key，下载报告不含 key，trace 不含 key。LLM 不可达自动降级规则解析（演示零风险默认）。

### 下一步最优先做什么？

先接真实目标仓库的 Asset Indexer 和 Codex Adapter，因为它最能验证「组件复用和可维护代码」；之后再补 Figma Plugin 与回写 Patch。
