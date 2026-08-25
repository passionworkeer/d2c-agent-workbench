# D2C Agent Workbench：10 分钟面试 Demo 脚本

## 开场：30 秒

“这个 Demo 解决的不是截图转 HTML，而是如何把 Figma 里的设计意图编译成可维护、可评测、能进入研发流程的代码。重点有四个：结构化输入、企业资产复用、可观察的 Agent 工作流，以及独立评测驱动的修复闭环。”

先打开工作台，但不要立刻点击运行。让面试官看到三栏：“设计输入”“Agent 执行轨迹”“代码交付”。

## 1. 输入不是一张图：1 分钟

指向左栏并说明：

- 输入是离线 Figma Bundle，不依赖现场登录或 MCP 权限。
- Bundle 包含 Node Tree、Frame、Auto Layout、Hug / Fill / Fixed、组件实例、变量绑定和 SVG Preview。
- 截图只用于视觉对照；布局、语义和 Token 来自结构数据。
- 导入器会阻止路径穿越、绝对路径和过大的压缩包，并通过 Zod Schema 校验协议。

一句总结：“多模态在这里不是只看像素，而是融合视觉预览与 Figma 结构。”

## 2. 点击“运行完整演示”：1 分钟

点击 **运行完整演示**，让中间执行轨迹开始流动。默认演示完全在浏览器端播放，不依赖后端或网络。

解释状态机：

```text
UPLOADED → VALIDATED → NORMALIZED → ASSETS_INDEXED
→ COMPONENTS_MAPPED → CODE_PLANNED → GENERATED → BUILT
→ EVALUATED → REPAIRING → EVALUATED → COMPLETED
```

强调每一步都输出类型化 Event 和 Artifact，而不是把所有上下文塞进一次 Prompt。Mock Adapter 与真实服务使用相同协议；上传真实 Bundle 时由服务端通过 SSE 推送，现场演示时由浏览器端稳定播放。同一条 Trace 可以回放、定位失败和复现结果。

## 3. UISpec 与上下文工程：1 分 30 秒

说明 UISpec 是统一中间表示：

- Figma Importer 只负责解析外部结构。
- UISpec Compiler 把横向 / 纵向 Auto Layout 变成 row / column 语义，保留 Sizing、约束和 Token 引用。
- Build Agent、Eval Agent、对话式编辑都消费同一 UISpec，避免各自重新理解设计稿。
- 上下文按任务裁剪：组件匹配只获得 UISpec 节点、候选组件 API 和相关代码示例，不读取整个仓库。

一句总结：“UISpec 是这条链路的上下文压缩层和可编辑语义层。”

## 4. 企业组件与 Design Token：1 分 30 秒

指向中栏“组件匹配证据”：

- `Product Card / Default` 被映射到 `ProductCard`，并展示 import path、置信度和证据。
- 匹配不是让模型在仓库里盲猜，而是先由 Asset Indexer 召回候选，再由 Agent 在小范围内决策。
- 高置信度自动采用，中置信度标记 Review，低置信度请求人工确认。
- 颜色、间距、圆角优先生成 Token 引用，不写任意魔法数字。

这部分直接对应岗位里的“设计系统与工程资产接入”“企业组件库和历史资产复用”。

## 5. Build / Eval 双 Agent：2 分钟

指向右栏 72 分到 94 分的过程：

- Build Agent 负责代码计划、生成、构建和 Repair。
- Eval Agent 使用隔离上下文，独立检查 Geometry、组件复用、Token 合规、视觉、语义和代码质量。
- 首轮结果是 72，Violation 指出硬编码颜色、网格间距和组件复用问题。
- Repair 只修改对应问题，再做构建和复评，最终达到 94，提升 22 分。
- 通过门槛是总分至少 90 且没有 P0；不是让 Build Agent 自己宣布成功。

一句总结：“多 Agent 的价值不在角色数量，而在职责隔离、可验证反馈和受控修复。”

## 6. 可交付性：1 分钟

指向右栏“页面预览”、生成代码和“下载报告”：

- 页面不是最终截图，而是 React / TypeScript 交付物。
- 报告包含完整 Run、Trace、组件映射证据、两轮 Eval 与分数变化。
- 研发可以审查生成代码和 Diff，设计师可以追溯节点、Token 与视觉问题。
- 现场断网时浏览器 Mock Adapter 保证演示稳定；接入真实 Codex 后仍使用相同事件与 Artifact 协议。

如果要展示真实上传，可以选择 `product-grid.zip`。服务不可用时，界面会明确提示“上传失败”，再由你点击“使用演示数据继续”；系统不会把失败的真实上传伪装成成功。

## 7. 主动说明当前边界：45 秒

“为了先验证完整用户路径，这版把最不稳定的外部依赖放到了 Adapter 后面：默认使用浏览器全 Mock 数据，真实上传使用结构化离线 Bundle，组件目标是固定 SDS Registry。它不是声称已经解决任意仓库生成；下一阶段会依次替换为真实 Asset Indexer、Codex Adapter、Figma Exporter 和 Playwright Geometry / Visual Eval。核心协议和工作台无需重写。”

这样既能体现工程判断，也不会把 Replay 包装成真实模型结果。

## 8. 收尾：45 秒

“这个项目覆盖了 JD 的六个重点：Agent 架构与工作流、Figma 多模态 UI 理解、D2C 出码、企业设计系统检索复用、设计研发协作界面，以及可量化的评测反馈闭环。我优先做了一个可现场稳定运行的纵向切片，再逐层替换真实能力，避免先堆 Agent 或 MCP 却没有可验证交付。”

## 常见追问

### 为什么不用一个超长 Prompt？

因为输入解析、组件检索、生成和评测需要不同权限、上下文与失败处理。协议化 Artifact 能减少上下文污染，并支持重试、回放和局部修复。

### 为什么先不用 Figma MCP？

MCP 是 Transport，不是核心业务能力。离线 Bundle 更容易控制权限、版本和面试稳定性；未来增加 `FigmaMcpAdapter` 时不需要修改 UISpec 之后的链路。

### 如何接企业代码仓库？

扫描 export、Props、Storybook、Code Connect、Token 和历史用法，生成可增量更新的结构化索引。检索阶段只提供最相关候选和证据，再让 Agent 决策。

### 如何防止评测刷分？

Build 和 Eval 隔离上下文；关键门槛由 TypeScript、Build、页面加载和关键节点检测决定；视觉模型只做问题归因，不单独决定通过。

### 下一步最优先做什么？

先接真实目标仓库的 Asset Indexer 和 Codex Adapter，因为它最能验证“组件复用和可维护代码”；之后再补 Figma Plugin 与回写 Patch。
