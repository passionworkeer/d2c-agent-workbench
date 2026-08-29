# D2C Agent Workbench：面试 Demo 脚本

> 两个版本：**3 分钟版**（重点亮点串讲） / **10 分钟版**（完整功能覆盖 + JD 映射）。
> 现场默认从 **3 分钟版**开始；面试官追问时按 **10 分钟版** 的对应章节展开。

---

## 3 分钟版（先讲亮点）

### 开场 20 秒

“这个 Demo 解决的不是截图转 HTML，而是**如何把 Figma 的设计意图编译成可维护、可评测、可进入研发流程的代码**。我会演示七个亮点：真实评测闭环、可观察 Agent 工具调用、对话式画布编辑、真视觉模型、企业组件资产库接入、设计稿回写 Figma，最后压轴是一条**真实构建渲染评测修复的生产闭环**。”

让面试官先看到三个区块（自上而下：「设计输入」→「Agent 执行轨迹」→「代码交付」）。

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

### 亮点 4：真视觉模型 + Figma 回写 30 秒

- I2D 上传一张参考图 PNG（provider=llm + key）→ vision-note 显示「已使用真实视觉模型识别」，SPEC_GENERATED 事件的 uiSpec / mappings / tokens 全部来自模型输出（toolCalls `vision.*`）
- 断网再传一张 → 如实显示「视觉模型不可达，已降级演示链路」
- 编辑两轮后展开「回写 Figma」面板：**预览变更**（dryRun 零写入）→ **应用到 Figma** → trace 追加 `SPEC_EXPORTED`（target=figma）；PAT 只存 localStorage，走 X-Figma-Token 头经代理

### 亮点 5：企业组件资产库 + 一致性守护 20 秒

- 「怎么接你们公司设计系统？」——`packages/asset-indexer` 扫描设计系统仓库（React + Storybook + Code Connect）注入 matcher，不改 workbench 代码；`examples/sample-design-system/` 是 6 个真组件的样本，扫描结果与内置静态表在 product-grid 上逐字节一致（测试钉死）
- 浏览器内本地真实执行 vs server SSE 路径，`scripts/consistency.test.ts` 钉两路逐字段一致

### 亮点 6：真实生产闭环（压轴）60 秒

切到顶栏「**活动页生产**」模式（PRODUCTION）：

- 点「载入黄金样例」→「运行生产闭环」。这不是演示管线，是**真的**：目标仓库复制进隔离工作区 → `pnpm install` → 真实 `tsc` typecheck → 真实 `vite build` → 自由端口起 `vite preview` → Playwright 渲染采集逐节点几何
- 黄金样例内置一处可修复问题（目标仓库骨架 padding-left 48px vs 参考稿 hero x=0）：首轮评测产出 `layout:hero` **P1** → 点击违规展开 **Region → Node → Source**（直接定位到 CampaignPage.module.css 的 .hero）→ **桌面截图上叠加红框圈出 hero 区域**（按节点几何等比缩放、按 severity 上色）→ 定向修复**只改这一个文件**（CSS 声明级补丁，回滚快照已存档）
- 复评后 **COMPLETED，终局 93+ 分**。事件流里每个状态都带真实 Artifact ID；build 失败是 P0 硬门槛，任一视口横向溢出是 P1 硬门槛，分数刷不掉
- **诚实评分一幕**：跑完后看右上「评测分构成」面板——总分 = 视觉 × .70 + 工程 × .30；视觉子分里 perceptualDiff 由服务端注册的真实参考截图（`examples/activity-pages/{sample}/reference.png`）跑 pixel diff 得出，textConsistency 100 是从 spec 文本节点与渲染 DOM.textContent 逐项对比得出（展开面板可见每行 ✓），semanticReview 标注证据来源：配了 MiniMax key 时是**实时双图语义评审**（布局 / 文案 / 视觉 / 任务链路四维子分 + 区域化 issues，可展开），没配 key 则如实标「黄金基准回退」——不冒充真实 VLM 结果。面板下方「VLM 语义复核（闭环外）」还可一键拉真视觉模型对比参考图与渲染截图（key 仅存浏览器 localStorage，经代理转发）：VLM 实测分与闭环证据**并列展示**、逐条差异可见，但**不计入 finalScore**——闭环评分保持无 key 也可复现，VLM 是按需的复核证据而非门槛，这是可部署工程的取舍。
- **真实手机页一幕（压轴中的压轴）**：样例条切到带缩略图的「快手商城（信息流页·真实截图）」→ 同一闭环跑 390px 手机端整页：实测 75-80 分（commerce 79.8 / festival 78.1 / pet 75.3）过服务端声明的验收门槛 70——照片重采样 + 语义重建导航的像素对比天花板摆在那里，**分数诚实展示，不靠调宽容度刷高**；任一视口零横向溢出（P1 硬门槛）、page 根节点几何贴近 spec canonicalViewport；三张真实截图（快手商城 / 夏日游戏节 / 养萌宠红包）都是「原图作图集素材 + 语义化组件」混合重建，导航 / 任务 / 奖励按钮是本地演示交互。E2E（`production-real-pages.spec.ts`）从服务端 Artifact 回读真实视口几何逐节点对照 spec sourceBox——高保真是可复核的数字。
- **导出 Figma 一幕（可选）**：闭环完成后点「下载 Figma 导入包」——version 2.0 自包含 JSON（素材 base64 随包、图节点归一化 crop、Auto Layout 结构）；再到 Figma 用本仓库的离线导入插件（`apps/figma-importer-plugin`，manifest 声明零网络、不读任何令牌）把包重建为可编辑图层，`pluginData.d2cNodeId` 保留稳定 Node ID。预生成包在 `examples/activity-pages/<样例>/figma-import.json`。
- **设计干预一幕**（60 秒内完成）：闭环完成后在「Puck 原型编辑」里把标题改成”全场 6 折”→ 点「保存编辑到 Run」（类型化 SpecEditOp 回写 ActivitySpec，不直接改代码）→ 工作台「文本证据」面板自动展开，标题行新增「基线（保存前）· 全场 5 折」列，与新 spec「全场 6 折」并列，差异列直接显示「✓ 编辑已应用」——观众立刻看到编辑意图落到了 ActivitySpec；点「按编辑重跑闭环」→ 重新生成 → 构建渲染复评 → 渲染 DOM 列也跟着变成 6 折——"编辑意图直达代码，全程可追溯"
- 收尾可切第二个黄金样例「体验官招募（表单页）」再跑一遍：**不同分数、不同修复文件**（表单页是 SummerFormPage.module.css）——不同页面结构、独立分数，证明评分非硬编码；时间充裕再切「快手商城」真实移动样例（手机实拍 jpg 参考图 + 图集裁切资产），跑出 **NEEDS_REVIEW 90.6 分 + 剩余 3 违规**——不是所有样例都满分收场，这本身就是评测诚实的活证据；最后点「下载 Run 报告」把完整证据链（事件流 + 分数构成 + 文本证据 + 违规 + 逐节点几何）作为 JSON 带走- 一句话收束：”前面五条亮点是可演示的链路，这一条是能落进研发流程的系统——每一步可追溯、可回滚、可评测、可被设计意图干预，**且评测本身不撒谎**。”

> 现场提示：服务端启动即后台预热依赖（讲解 D2C/I2D 的一两分钟里就热好了），单次闭环约 20–30 秒；install 带 `--prefer-offline`，store 热了以后**会场断网也能跑压轴环节**（store 冷时自动回退联网）。万一现场翻车，事件流也会如实停在 FAILED，不假装成功——这本身就是卖点。**Profile/命令注册在服务端，客户端无法注入 commands**——`apps/server/src/profiles.ts` 是唯一允许的目标仓库清单；这层安全姿态也是审计钉死的。

### 收尾 20 秒

“这个项目回挂了 JD 的 6 个职责 + 8 个要求。**[3 分钟版结束，10 分钟版从下面继续]**

---

## 10 分钟版

### 0. 开场 30 秒

“这个 Demo 解决的不是截图转 HTML，而是如何把 Figma 里的设计意图编译成可维护、可评测、能进入研发流程的代码。重点有四个：结构化输入、企业资产复用、可观察的 Agent 工作流，以及独立评测驱动的修复闭环。”

先打开工作台，但不要立刻点击运行。让面试官看到三个区块（上下排布：「设计输入」→「Agent 执行轨迹」→「代码交付」）。

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
- **Registry 可注入**：`packages/asset-indexer` 把设计系统仓库扫描成 registry（组件 export 名、`.figma.tsx` 的 Figma 名对照、Storybook title/argTypes）；`examples/sample-design-system/` 是 6 个真组件样本，扫描结果与内置静态表在 product-grid 上产出逐字节一致的映射（测试钉死）。“接你们公司设计系统” = 扫描一遍仓库，不改 workbench 代码。

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

### 7. 视觉模型 + 对话式画布编辑 + Figma 回写：2 分 30 秒

切到 I2D → 自动播放 → ChatPanel 输入「把第二张卡片换成 lime」→ 发送：

- 画布实时刷新（card-2 className 切换）
- trace 实时追加 `CANVAS_EDITED` 事件 + toolCalls
- **默认 Provider = 规则解析**（演示零风险，离线可跑）
- 切到「设置面板」改成 LLM（MiniMax / Anthropic 兼容端点）→ 填 key → 再次发送
- 看 toolCalls 变 `llm.interpretIntent` + 真实 POST /api/canvas/interpret（key 走 X-LLM-Key 请求头）
- **拔掉 key / 断网重发**：自动降级规则解析 + ChatPanel 提示「LLM 不可达」+ toolCalls `fallback:true`

**真视觉模型**（provider=llm + key 时自动启用）：

- 上传一张参考图 PNG → 服务端 `POST /api/vision/interpret` 用 Anthropic vision 格式（base64 image content block）+ `emit_ui_spec` tool calling
- 模型输出不进自由文本：tool 参数经 zod 校验后才进链路（UISpec / mappings / tokens）
- SPEC_GENERATED / COMPONENTS_DETECTED 载荷全部换成真实识别结果，toolCalls 标 `provider=llm`
- 失败（模型不可达 / 输出不符 schema）自动降级演示链路，画布上方 vision-note 状态行如实标注原因（成功绿 / 降级橙 / 演示灰三态）

**Figma 回写**（编辑产生价值闭环）：

- 对话编辑累计的 EditOp 就是回写范围；「回写 Figma」面板填 PAT（写权限）+ File Key，两者只存 localStorage
- **预览变更**：dryRun 请求只返回 nodeChanges（`packages/figma-patcher` 转换：token 引用解析字面量、GRID 布局降级记录），不落 Figma
- **应用到 Figma**：PAT 走 X-Figma-Token 头经代理 PUT 到 Figma REST 写端点；成功后 trace 追加 `SPEC_EXPORTED`（target=figma）
- 写权限不足的 PAT：自动降级为把变更 JSON 以评论发布到目标文件，面板如实标注 transport=comment

### 8. 可交付性：1 分钟

指向右栏「页面预览」、生成代码和「下载报告」：

- 页面不是最终截图，而是 React / TypeScript 交付物。
- 报告包含完整 Run、Trace、组件映射证据、两轮 Eval 与分数变化、token compliance、violation id、toolCalls。
- 研发可以审查生成代码和 Diff，设计师可以追溯节点、Token 与视觉问题。
- 现场断网时浏览器内确定性管线保证演示稳定；接 LLM 走同一份事件与 Artifact 协议。

如果要展示真实上传，可以选择 `product-grid.zip`。服务不可用时，界面会明确提示「上传失败」，再由你点击「使用演示数据继续」；系统不会把失败的真实上传伪装成成功。

### 9. 主动说明当前边界：45 秒

“这版把最不稳定的外部依赖放到了 Adapter 后面：默认使用浏览器内确定性管线，真实上传使用结构化离线 Bundle，LLM / 视觉模型默认演示链路（key 不进仓库、不进日志、不进下载报告），Figma 回写可选接真实 PAT。黄金样例已扩到 5 个（含 3 个手机实拍参考图的真实移动活动页，全部可跑通完整生产闭环）；MiniMax 双图语义评审已接进生产闭环（失败如实回退注册基准分），三张真实手机活动页已落为 390px 高保真黄金样例，Figma 离线导入插件已就绪；下一阶段是 Figma 桌面端实弹导入验证，并把黄金样例扩到 12 页规模。核心协议和工作台无需重写。”
### 10. 收尾 + JD 映射：45 秒

“这个项目覆盖了 JD 的六个重点（Agent 架构与工作流 / Figma 多模态 UI 理解 / D2C 出码 / 企业设计系统检索复用 / 对话式画布编辑 / 评测反馈闭环）和八个要求（LLM 框架 / Figma 工具 / 前端工程 / UI 设计理解 / 评测指标 / 真实场景落地 / 文档沟通 / 工程能力）。具体每条 JD 对应哪个代码点，见 `docs/jd-mapping.md`。”

---

## 常见追问

### 为什么不用一个超长 Prompt？

因为输入解析、组件检索、生成和评测需要不同权限、上下文与失败处理。协议化 Artifact 能减少上下文污染，并支持重试、回放和局部修复。每个 trace event 都带 `toolCalls`，便于事后审计与对齐 LLM 行为。

### 为什么先不用 Figma MCP？

MCP 是 Transport，不是核心业务能力。离线 Bundle 更容易控制权限、版本和面试稳定性；未来增加 `FigmaMcpAdapter` 时不需要修改 UISpec 之后的链路。LLM 同理：`@d2c/canvas-ops` 是 provider-agnostic 的，规则解析默认 + LLM 通过 `POST /api/canvas/interpret` 接入，未来加 MCP / Bedrock / Anthropic SDK 都只改 `apps/server/src/llm.ts`。

### 如何接企业代码仓库？

`packages/asset-indexer` 已经能扫描设计系统仓库（组件 export、Props（Storybook argTypes）、Code Connect、Figma 名对照）生成 registry，`mapSdsComponents(spec, registry?)` 直接注入；`examples/sample-design-system/` 是样本。扫描约定刻意从简（正则可解析、人可读）；真实仓库如有 AST 需求，替换 `scanRepo` 单个函数即可，链路不动。检索阶段只提供最相关候选和证据，再让 Agent 决策。

### 如何防止评测刷分？

Build 和 Eval 隔离上下文；关键门槛由 TypeScript、Build、页面加载和关键节点检测决定；视觉模型只做问题归因，不单独决定通过。所有 violation id 都是草稿产物的 DFS 序 fold，由测试钉死；改 fixture 不会让分数巧合不变。

### LLM 真的接进来了吗？key 怎么保管？

接了（`apps/server/src/llm.ts` + `apps/server/src/vision.ts`，文本与视觉两条链路）。key 只存浏览器 localStorage（设置面板），走 X-LLM-Key 请求头到本地 Fastify 代理，代理再转发到 MiniMax。仓库任何文件不含 key，下载报告不含 key，trace 不含 key。LLM 不可达自动降级规则解析（演示零风险默认）；视觉模型失败自动降级演示链路并如实提示。

### Figma 回写是怎么做的？PAT 安全吗？

对话编辑累计的 EditOp 经 `packages/figma-patcher` 转成 Figma setNodeChanges（selector 语义复用 canvas-ops，保证「画布怎么改、Figma 就改哪」），PAT 走 X-Figma-Token 请求头经本地代理 PUT 到 Figma REST 写端点。PAT 只存 localStorage，不进仓库 / 日志 / 下载报告 / 响应体（测试钉死）。写权限不足的 PAT 自动降级为评论发布变更 JSON——失败也诚实可见，不假装成功。

### 下一步最优先做什么？

真实代码生成、隔离构建与 Playwright 渲染评测已在 PRODUCTION 模式落地（含错误归因与文件级定向修复）。剩余优先级：视觉模型按 Region 归因接入像素 diff（compareImages 适配器已留位）、真 PAT 的 Figma 回写实弹彩排；黄金样例已扩成 5 页面回归集（2 个手造黄金 + 3 个真实移动活动页，e2e 钉死）。

## 演示动线 4：活动页生产闭环（PRODUCTION）

> 入口：顶栏「活动页生产」模式。这条链路从设计意图直达真实可构建的代码，全程 Artifact 可追溯。

1. 切到「活动页生产」模式，讲清定位：D2C 演示链路（确定性管线）、I2D（可选真视觉模型）、PRODUCTION（真实构建渲染评测修复）三者边界。
2. 点击「载入黄金样例」：展示黄金 fixture（`examples/activity-pages/campaign/`——参考稿、PRD、ActivitySpec、目标 Profile 四件套）。
3. 点击「运行生产闭环」，按事件流讲解：
   - **工作区播种**：目标仓库 `examples/activity-target` 复制进隔离工作区（忽略 node_modules），`pnpm install` 真实安装依赖；Profile / 命令在 `apps/server/src/profiles.ts` 服务端注册，客户端 POST 时不可注入 commands
   - **真实代码**：生成器写出 CampaignPage.tsx + CSS Module + source map，节点带稳定 id；workspace.apply 同步落 plan.assets
   - **typecheck / build**：真实 `tsc` 与 `vite build`，白名单命令、最小 env 白名单（PATH/Node/HOME 等），超时杀树；失败即 P0，分数不可覆盖；**修复后失败自动 restoreRollback 到修复前快照**
   - **渲染评测**：`vite preview` 起服务，Playwright 双视口（desktop 1440×900 + mobile 390×844）渲染，采集逐节点几何——首轮 hero 偏移 48px（目标仓库骨架的已知问题），产出 `layout:hero` P1；**任一视口横向溢出也是 P1 硬门槛**
   - **归因与局部修复**：点击违规展示 Region → Node → Source（CampaignPage.module.css 的 .hero），**桌面截图上叠加红框圈出 hero 区域**（按节点几何等比缩放、按 severity 上色），修复仅触碰 1 个文件，CSS 声明级替换，回滚快照已存档
   - **诚实评分**：复评后看「评测分构成」面板——总分 = 视觉 × .70 + 工程 × .30；perceptualDiff 走真实像素 diff（每个黄金样例在服务端注册了 reference.png + compareImages 适配器），textConsistency 100 附带 spec 文本 vs 渲染 DOM 的逐项对比（展开面板可见每行 ✓），semanticReview 是服务端黄金基准（闭环外另有「VLM 语义复核」按钮拉真视觉模型并列对比，不计入 finalScore）——**评测本身不撒谎**
   - **复评通过**：修复后重新 typecheck/build/渲染评测，hero 回到 (0,0,1440,500)，终局分数 ≥90，状态 COMPLETED。
4. 收尾追问点：
   - **为什么不重新生成整页？** 修复是文件级定向 patch（≤5 文件、幂等 CSS/AST 补丁），保留人工确认的映射与编辑。
   - **怎么防刷分？** build 失败是 P0 硬门槛；任一视口溢出是 P1 硬门槛；评测输入全部来自真实渲染几何；缺证据记 null 按可用项归一权重而非默认 100
   - **怎么接我们公司仓库？** 在 `apps/server/src/profiles.ts` 注册 Profile（commands/allowedWriteGlobs/repositoryPath），客户端 POST 时只能选 sampleId 不能注入；commands 经最小 env 白名单过滤后执行
   - **怎么回到设计工具？** Puck 原型编辑（类型化 EditOp）与 Figma 导出（保留 d2cNodeId 的 html-to-figma 包）与代码共用同一份 ActivitySpec。
