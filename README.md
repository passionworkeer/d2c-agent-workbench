# D2C Agent Workbench

一个面向面试演示的、可追踪且可评测的 Design-to-Code 工作台。它把结构化 Figma 资产编译为 UISpec，基于团队设计系统匹配组件与 Design Token，再通过 Build / Eval 双 Agent 工作流完成代码生成、问题归因和自动修复；并支持参考图 / Figma → 设计稿（I2D）、真视觉模型识别、LLM 可选的对话式画布编辑，以及设计稿回写 Figma。

![CI](https://github.com/passionworkeer/d2c-agent-workbench/actions/workflows/ci.yml/badge.svg) ![工作台结构](https://img.shields.io/badge/Figma%20Bundle-%E2%86%92%20UISpec-c8ff38) ![组件匹配](https://img.shields.io/badge/SDS-%E7%BB%84%E4%BB%B6%E8%AF%81%E6%8D%AE-ff6433) ![评测闭环](https://img.shields.io/badge/Eval-72%E2%86%9294-c8ff38) ![LLM](https://img.shields.io/badge/LLM-MiniMax%20M3-ff6433)

![D2C Agent Workbench 完成态](docs/workbench-completed.png)

## 当前 Demo 能做什么

- 读取并校验离线 `figma-bundle.zip`，包括 Node Tree、Auto Layout、变量、组件实例和 SVG 预览。
- 将 Figma 结构递归编译为稳定、可验证的 UISpec（Auto Layout → row / column / grid，Token 引用保留）。
- 在固定 SDS Registry 中检索 `Header`、`ProductCard`、`Input` 等组件，展示置信度与匹配证据。
- 默认由浏览器端**确定性管线**真实执行 12 步 Agent 轨迹（不是 Mock 字符串拼接），不依赖后端、网络或模型服务；与上传走同一 `runReplayWorkflow`，`scripts/consistency.test.ts` 守护两路逐字段一致。
- 上传真实 Figma Bundle 时，通过 Fastify 与 SSE 展示同一套工作流；上传失败可显式降级到演示数据（**不**把失败假装成成功）。
- **真实代码生成**：草稿与终稿走同一 DFS 元素发射 + StyleRef 落点；评分与 violation 都从产物计算得到，不是字面量。
- 独立计算 Geometry、组件复用、Token 合规、视觉、语义和代码质量六维指标。
- 演示首轮 72 分、Repair Agent 修复、复评 94 分的闭环（校准测试钉死）。
- **双 fixture 泛化**：`product-grid`（72 → 94）和 `form-page`（52.1 → 91.9）走同一渲染器和同一管线，分数与 violation id 完全独立。
- **I2D（参考图 / Figma → 设计稿）**：自动播放完成 `STRUCTURE_IMPORTED → LAYOUT_INFERRED → COMPONENTS_DETECTED → TOKENS_BOUND → SPEC_GENERATED`，最后生成可下载的设计稿 JSON。
- **真视觉模型（可选）**：I2D 上传参考图时，provider=llm 且已填 key 则调用 MiniMax 视觉端点（image content block + `emit_ui_spec` tool calling）产出真实 UISpec / mappings / tokens，toolCalls 标 `provider=llm`；失败自动降级演示链路并如实提示。
- **对话式画布编辑**：ChatPanel 输入中文指令（如"把第二张卡片换成 lime"），画布实时刷新 + trace 实时追加 `CANVAS_EDITED` 事件。默认走规则解析（演示零风险），可选切换到真实 LLM（MiniMax Anthropic 兼容端点）。
- **LLM 不可达自动降级规则解析** + ChatPanel 提示 + toolCalls 标记 `fallback:true`，不会让演示因网络或 key 失效而中断。
- **企业组件资产库**：`packages/asset-indexer` 把设计系统仓库（React 组件 + Storybook + Code Connect）扫描成 matcher 可注入的 registry——`examples/sample-design-system/` 是 6 个真组件的样本，扫描结果与内置静态表在 product-grid 上产出逐字节一致的映射（测试钉死）。`GET /api/health?scan=dynamic` 实时返回动态 registry 大小。
- **设计稿回写 Figma**：I2D 对话编辑累计的 EditOp 经 `packages/figma-patcher` 转成 Figma setNodeChanges（token 引用解析字面量、GRID 布局诚实降级记录），PAT 走 `X-Figma-Token` 头经代理 PUT 到 Figma REST；写权限不足自动降级为评论发布变更 JSON。
- **可导出 D2C Skill**：顶栏一键下载离线 ZIP——完整 Agent Skill 包（`SKILL.md` 的输入检查、有无设计资产的降级分支、执行顺序与停止条件 + `references/` 方法文档 + 只读资产扫描脚本），把 Web 演示的方法沉淀为可迁移到其它 Agent 的能力包；ZIP 与 `skills/d2c-agent-workbench/` canonical 目录逐字节一致（测试钉死），不依赖后端。
- 下载包含 Run、Trace、Mapping、Evaluation（含 `resolvedViolationIds`）和 toolCalls 的结构化报告，**不含 LLM key / Figma PAT**。

> 默认演示的 Agent 输出是浏览器内确定性管线的真实执行（产物扫描、类型化修复、LCS Diff），不是字符串 Mock。LLM 通过 `POST /api/canvas/interpret` 可选接入；key 仅存浏览器 localStorage（设置面板），仓库任何文件、下载报告与日志都不含 key。

## 活动页生产（PRODUCTION）模式

在 D2C / I2D 之外，工作台新增**真实生产闭环**：以 `ActivitySpec v2` 为单一事实源，把设计意图一路推进到可交付的活动页代码。

- **真实代码生成**：`packages/codegen` 生成真正的 TSX + CSS Module（带 `data-d2c-node-id` / `data-d2c-ready` 稳定标记）与 `d2c-source-map.json`，而不是 JSX 字符串。
- **隔离工作区**：目标仓库骨架（`examples/activity-target`）被复制进 `.data/production/workspaces/<runId>`，忽略 `node_modules/.git/dist`；所有写入都在 Profile `allowedWriteGlobs` 边界内，产物用 `wx` 一次性写入不可覆盖。
- **Profile / 命令服务端注册**：`apps/server/src/profiles.ts` 按 `sampleId` 解析固定 Profile（commands、repositoryPath、allowedWriteGlobs 全部硬编码），客户端**不可**注入 commands——这是默认安全姿态；mappings / referenceNodes 在 POST 时经 Zod 严格校验后入库。
- **真实命令执行**：`pnpm install` / `typecheck` / `vite build` 先按参数数组精确匹配服务端白名单，再由 `spawn` 执行；Windows 为兼容 `.CMD` 垫片启用 shell，其它平台关闭 shell。命令与 preview 子进程都只继承最小化 env 白名单（PATH / Node / HOME 等），超时终止完整进程树，输出限幅。
- **真实渲染评测**：`vite preview` 起在自由端口，Playwright 按 1440×900 固定 DPR 渲染，采集截图、运行时错误与逐节点几何；**任一视口**（desktop / mobile）横向溢出 → P1 硬门槛，build 失败是 P0 硬门槛，任何分数不可覆盖。
- **证据驱动评分**：视觉指标（perceptualDiff / textConsistency / colorEffects / assetConsistency / semanticReview）各自产出 `*Available` 布尔；缺证据记 `null` 而非默认 100，按可用项归一化权重，避免无声 100 蒙混通过。语义评审 / 像素 diff 缺为 P1 并阻塞 passed；闭环内 semanticReview 优先接真实 MiniMax 双图评审，未配 key 或调用失败时回退服务端注册基准分并如实标注 provider；**闭环外**还可一键拉真视觉模型复核（见下）。
- **闭环外 VLM 语义复核**：`POST /api/production/runs/:id/semantic-review` 让真视觉模型对比参考图与渲染截图，产出分数 + 逐条差异观察；key 走 `X-LLM-Key` 头仅本次请求生命周期，复核结果不写 run.json / 事件流 / 下载报告。工作台把「VLM 实测」与闭环内语义评审证据**并列展示但不计入 finalScore**——闭环评分保持无 key 也可复现，这是可部署工程的取舍：客观指标作门槛，智能评审作复核证据。
- **错误归因与局部修复**：几何/diff 违规映射到 Region → Node → Source；修复只允许 ≤5 个文件、CSS 声明级 / ts-morph AST 级补丁，每轮先写回滚快照，**修复后 typecheck/build 失败自动 restoreRollback** 到修复前快照，最多 3 轮、连续两轮提升 <1 分即停。
- **工作台评测分构成**：EVALUATED 事件透传 `metrics` 与 `text` 证据，工作台渲染「评测分构成」面板——总分三栏 + 视觉/工程子分对照表，缺证据项显式标红（如「缺参考截图」「依赖 perceptualDiff」），并能展开 spec 文本节点 vs 渲染 DOM.textContent 的逐项对比，证明 100 分是逐项 ✓ 而非凭空给定。Puck 保存编辑后该面板自动展开，新增「基线（保存前）」列，差异列标「✓ 编辑已应用」，把"设计意图落到了 ActivitySpec"演给观众看。
- **工作台 Region 叠加**：选中违规时在桌面截图上叠加定位框（按 `violation.nodeIds → viewport.nodes` 等比缩放，按 severity 上色 P0/P1/P2），把归因数据从文字落到真实页面区域。
- **工作台横向溢出标注**：mobile / 任一视口的 `documentElement.scrollWidth > clientWidth` 直接在工作台渲染截图上描红边 + 标注「⚠ 横向溢出 → P1」，把「任一视口也是 P1 硬门槛」演给观众看。
- **服务端 API**：`POST /api/production/runs` → SSE 事件流 → `GET /runs`（历史清单）/ `confirm-mapping` / `edit` / `repair` / `semantic-review` / 产物读取，Run 元数据落盘可重载；启动自动重载历史 run 的 spec/profile/mappings/status（崩溃遗留的 running 僵尸如实改判 failed），并清理重启后成为孤儿的隔离工作区（每个含完整 node_modules，不清会累积到 GB 级）；证据链在 artifacts/ 与 renders/ 持久化，不受清理影响。
- **历史 Run 回看**：`GET /api/production/runs` 返回全部记录（含重启后重载），工作台「历史 Run」面板点任一条即只读回看——事件流、评测分构成、文本证据、违规与双视口几何整批还原，Run 报告照常可下载；回看态隐藏原型编辑（无工作区引用，修复由服务端如实 409）。磁盘 run 目录按 createdAt 封顶 MAX_RUNS（50）自动淘汰最旧，与内存水位一致。
- **启动即预热依赖**：服务端启动后后台把目标仓库播种进 `.data/production/warm/` 跑一次 install 填热 pnpm 全局 store——演示时首个生产闭环不再付冷启动下载，讲解前两条链路的时间刚好够热好；install 带 `--prefer-offline`，store 已热时跳过 registry 请求，会场断网也能跑完压轴环节（store 冷时自动回退联网）。
- **视觉草稿（可选）**：截图 + PRD 结构化事实 + OCR/素材证据合并为 ActivitySpec 草稿，PRD 覆盖冲突写入 unresolved；支持 `D2C_VISUAL_SIDECAR_URL` 切换 screenshot-to-code 兼容 Sidecar。
- **Puck 可编辑原型与 Figma 导出**：ActivitySpec ↔ Puck 双向适配（完整节点进入编辑器，编辑发出类型化 SpecEditOp，运行前修改会进入本轮生成）；工作台可直接下载 `buildFigmaImportBundle` 产出的 html-to-figma 兼容节点 JSON，并保留 `pluginData.d2cNodeId`。插件端实际导入仍需在真实 Figma 环境验证。
- **三个真实手机活动页（压轴样例）**：三张真实移动端截图（快手商城信息流 / 夏日游戏节任务页 / 养萌宠红包养成页）经「方案 C 混合重建」落为 `examples/activity-pages/` fixture——原图作整页图集素材 + 语义化 React 组件重建导航 / 任务 / 奖励区，本地演示交互不接真实后台；样例带参考图缩略图并明示「390px 手机端 · 高保真整页还原」，E2E 从渲染 Artifact 的真实几何对照 spec sourceBox 逐节点复核（3% 容差）。
- **语义评审证据（MiniMax 实时 / 基准回退）**：评测闭环接 MiniMax 双图语义评审（spec 文本 + 渲染截图 → 布局 / 文案 / 视觉 / 任务链路四维子分 + 区域化 issues）；未配 key 或调用失败时如实回退服务端注册基准分并标 `provider=registered-fallback`，证据随 run 持久化、重启可查，工作台「评测分构成」面板展开四维子分与 issues 列表。
- **Figma 自包含导入包 v2**：`buildFigmaImportBundle` 产出 version 2.0 导入包——顶层 viewport、节点 layout（Auto Layout 方向 / gap / padding）、素材 base64 随包携带（真实样例即整页图集原图）、图节点 `imageCrop` 按 `spec.assets[].evidence[].region` ÷ 嵌入图集固有像素尺寸归一化（exporter 自解析 JPEG SOF 段得图集尺寸，黄金样例走 sourceBox÷viewport 回落）、填色按「Playwright 实测 → `spec.visual`」兜底（无渲染证据的预生成/闭环前下载也带正确颜色 + 半透明 opacity）、节点 x/y 为页面绝对坐标（与 spec sourceBox 一致，插件端按父级页面原点换算为 Figma 父级相对）、缺渲染证据的节点进 `degradations` 如实降级。
- **Figma 离线导入插件**：`apps/figma-importer-plugin` 零运行时依赖，手写结构校验（不用 zod），把导入包在真实 Figma 里重建为 Frame / Text / Rectangle / Image（crop 矩阵），`pluginData.d2cNodeId` 保留稳定 Node ID；`networkAccess.allowedDomains` 为空——**不联网、不读取任何令牌**。三份预生成导入包在 `examples/activity-pages/<样例>/figma-import.json`（生成时即用插件同款解析器校验）。插件在真实 Figma 桌面端的人工导入验证仍待完成。
- **Run 报告下载**：闭环完成后一键下载 `production-run-<id>-report.json`——含完整事件流（每步 Artifact 引用）、终局分数、评测分构成、文本证据、违规清单与双视口逐节点几何，把「每一步可追溯」变成可带走的结构化证据链（与 D2C 模式的报告同一惯例，不含任何密钥）。
5 个黄金样例：`campaign`（主视觉页）与 `summer-form`（表单页）是演示骨架，`campaign` 内置一处可修复的 Hero 间距问题（目标仓库骨架 `padding-left: 48px` vs 参考稿 hero x=0）：首轮评测产出 `layout:hero` P1，局部修复仅改生成的 Campaign CSS，复评后状态 `COMPLETED`、终局分数 ≥90。另外 3 个是真实手机截图样例（`commerce-feed` / `summer-game-festival` / `pet-red-packet`），目标仓库对应组件以 fixture spec 为单一事实源构建（`real-pages.test` 钉死逐节点文本一致），E2E 跑完整生产闭环并复核 390px 整页几何。

外部依赖说明：三种模式边界清晰——**D2C**（浏览器内确定性管线，零依赖）、**I2D**（可选 MiniMax 视觉模型 / Figma PAT）、**PRODUCTION**（需要 pnpm 可用、目标仓库可安装构建；视觉草稿的模型调用可选）。

## 3 分钟快速演示（面试动线）

```bash
pnpm install
pnpm dev          # 同时启动前端 5173 与 API 8787
```

打开 `http://127.0.0.1:5173`，按顺序点三条链路：

1. **D2C（秒开）**：点「运行完整演示」→ 72→94 评测修复闭环，浏览器内确定性管线，零外部依赖；完成后点「导出 D2C Skill」带走可迁移到其它 Agent 的方法包（离线 ZIP）
2. **I2D**：切「参考图 → 设计稿」→ 自动播放 → （可选）填 key 接真视觉模型
3. **PRODUCTION（压轴，~20s）**：切「活动页生产」→ 载入黄金样例 → 运行生产闭环 → 真实 install/typecheck/vite build/Playwright 渲染/评测/局部修复 → COMPLETED 93+ 分，工作台「评测分构成」面板显示每个证据项的可用性与具体分；切换第二个样例（表单页）再跑 → 不同分数与不同修复文件（评分非硬编码）；再切三个真实截图样例（快手商城 / 夏日游戏节 / 养萌宠红包，带缩略图）→ 同一闭环跑 390px 手机端整页，实测 75-80 分过服务端声明的验收门槛（70，照片重采样 + 语义重建导航的像素对比天花板所致）、零横向溢出——分数诚实展示，门槛是服务端 Profile 按样例声明的显式参数
完整话术见 `docs/demo-script.md`（含 3 分钟版七个亮点）。

面试前彩排：`pnpm dev` 起服务后另开终端跑 `node scripts/demo-rehearsal.mjs`——按演示顺序自动走完三条链路（含快手商城真实样例段），逐步截图 + 计时（全链路约 45s）并断言关键结果（如真实样例实测分必须落在 75-80 诚实区间）；产物在 `.data/demo-rehearsal/`，可肉眼过一遍截图确认视觉状态。

## 立即运行

环境要求：Node.js 22+、pnpm 11+。

```bash
pnpm install
pnpm --filter @d2c/web dev
```

访问 `http://127.0.0.1:5173`，点击 **运行完整演示**。这条默认路径完全在浏览器内执行，只启动前端即可完成 72→94 的完整流程。

需要验证真实 Bundle 上传时，运行 `pnpm dev` 同时启动前端与 `http://127.0.0.1:8787` 的 Fastify 服务。

如需演示上传，直接选择仓库根目录的 `product-grid.zip`。修改示例资产后，可在 PowerShell 中重新生成：

```powershell
Compress-Archive -Path .\examples\figma-bundles\product-grid\* -DestinationPath .\product-grid.zip -Force
```

然后点击 **上传 Figma 资产包** 选择 `product-grid.zip`。如果服务不可用，界面会显示 **使用演示数据继续**，由用户主动切换到本地流程。

## 验证

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm e2e
```

> 跑 `pnpm e2e` 前先停掉本地 `pnpm dev`：Playwright 会复用已运行的 dev 服务
> （`reuseExistingServer`），旧进程可能载着过期代码导致诡异失败；生产闭环测试
> 与 demo 用例已配置串行（`workers: 1`），全套约 30 秒。

## LLM 设置（可选）

Demo 默认走规则解析，**不需要任何 key**。

如需切换到真实 LLM：

1. 在工作台顶栏 I2D 区点 **设置**（齿轮图标，仅 I2D 显示）。
2. Provider 选 `llm`，Base URL 填 `https://api.minimaxi.com/anthropic`（Anthropic 兼容端点），Model 填 `MiniMax-M3`。
3. 在 Key 字段填入你的 key，点 **保存**。
4. **安全约束**（已写进代码并由测试钉死）：
   - key 只存浏览器 localStorage，**不写入仓库任何文件**
   - 浏览器 → 本地 Fastify 代理（key 走 `X-LLM-Key` 请求头）→ MiniMax，规避 CORS
   - 下载报告、trace 日志、服务端日志均**不含 key**
   - LLM 不可达（断网 / 401 / 5xx / 超时）自动降级规则解析，ChatPanel 会显示降级提示

## 视觉模型（可选）

I2D 上传参考图默认走演示链路（零风险）。provider=llm 且已填 key 时自动升级为真实视觉模型：

- 请求走 `POST /api/vision/interpret`（key 复用 LLM 设置，同样走 `X-LLM-Key` 头经代理转发）。
- 服务端用 Anthropic vision 格式（base64 image content block）+ `emit_ui_spec` tool calling，返回经 zod 校验的 UISpec / mappings / tokens。
- 失败（模型不可达 / 输出不符 schema）自动降级演示链路，画布上方 vision-note 状态行如实显示降级原因。
- 真端点冒烟脚本：`node scripts/llm-integration.mjs`（读 `.env`，仓库已 gitignore）。

## Figma 回写（可选）

I2D 设计稿生成并对话编辑后，可在「回写 Figma」面板把编辑落回真实 Figma 文件：

1. 准备一个有**写权限**的 Figma PAT（Figma → Settings → Personal access tokens）。
2. 在回写面板（或设置 → Figma 标签页）填 PAT 与目标文件的 File Key（文件 URL 中 `file/` 后那段），两者仅存浏览器 localStorage。
3. **预览变更**：dryRun 请求只返回将写入的 nodeChanges（不落 Figma）。
4. **应用到 Figma**：PAT 走 `X-Figma-Token` 请求头经本地代理 PUT 到 Figma REST 写端点；成功后 trace 追加 `SPEC_EXPORTED`（target=figma）。写权限不足时自动降级为把变更 JSON 以评论发布到目标文件，面板如实标注 transport。

## 企业组件资产库

回答"怎么接我们公司设计系统"：不改 workbench 代码，扫描一遍设计系统仓库即可注册进 matcher。

```ts
import { scanRepo } from "@d2c/asset-indexer";
import { buildRegistryFromEntries, mapSdsComponents } from "@d2c/component-matcher";

const entries = await scanRepo({ repoRoot: "你的设计系统仓库" });
const mappings = mapSdsComponents(spec, buildRegistryFromEntries(entries));
```

扫描约定（正则可解析、人可读，详见 `examples/sample-design-system/README.md`）：组件 `export function Xxx`；Figma 名对照 `export const figmaComponentNames = [...]`（`*.figma.tsx`）；Storybook `title` + `argTypes`。单文件解析失败不阻断扫描，附 `parseError`。

## 架构

```text
浏览器确定性管线 ─────────────────────────────────┐
                                                  ▼
Figma Bundle → Safe Importer → UISpec → SDS Matcher → SpecRenderer
                                  │                  ▲
                                  ▼                  │
                       Build → Eval → Repair → Eval → CODE/Diff
                            ▲            │
                            └── planOps ─┘
                                                  │
I2D：参考图 / Figma → 设计稿生成 → ChatPanel ───────┘
                    │                              │
                    ├─→ POST /api/vision/interpret (视觉模型, X-LLM-Key)
                    │
                    └─→ canvas.parseIntent (本地规则)
                             │
                             └─→ POST /api/canvas/interpret (LLM, X-LLM-Key)
                                       │
FigmaPatchPanel ── POST /api/figma/patch (X-Figma-Token) ──→ Figma REST / 评论降级
```

| 模块 | 职责 |
|---|---|
| `packages/contracts` | Bundle、UISpec、Trace、Evaluation、EditOp 的 Zod 协议 |
| `packages/figma-importer` | ZIP 安全检查、资产解析和输入验证 |
| `packages/ui-compiler` | Auto Layout、Sizing、Token 到 UISpec |
| `packages/component-matcher` | SDS 候选召回、排序、证据和置信度 |
| `packages/codegen` | 真实 DFS 出码 + StyleRef 发射 + 类型化修复（tokenize / restore-value / define-token / snap-to-declared） |
| `packages/evaluator` | 证据驱动评测：5 项视觉指标各产出 `*Available` 布尔，缺证据归一化权重，杜绝无声 100 |
| `packages/orchestrator` | PRODUCTION 闭环状态机：INPUT_VALIDATED → PROJECT_INSPECTED → SPEC_VALIDATED → MAPPINGS_RESOLVED → CODE_PLANNED → PREPARING（播种+依赖安装）→ GENERATED → TYPECHECKED → BUILT → RENDERED → EVALUATED → ATTRIBUTED → REPAIR_PLANNED/APPLIED，多轮迭代 + 修复后失败自动 restoreRollback |
| `packages/production-runtime` | 隔离工作区（seedWorkspaceFrom）、白名单命令执行（runAllowedCommand + 最小 env）、Playwright 渲染、回滚快照与定向修复（applyPatchPlan） |
| `packages/canvas-ops` | 对话式画布编辑：`parseIntent` 中文规则 + `applyEditOps` 纯函数（set-prop / set-style / set-text / set-layout） |
| `packages/asset-indexer` | 企业组件资产库扫描器：设计系统仓库（React + Storybook + Code Connect）→ matcher 可注入的 registry |
| `packages/figma-patcher` | EditOp → Figma setNodeChanges：token 解字面量、GRID 降级记录、selector 复用 canvas-ops 语义；v2 自包含 Figma 导入包（viewport / layout / base64 素材 / 归一化 imageCrop / degradations） |
| `apps/figma-importer-plugin` | Figma 离线导入插件：零运行时依赖手写解析器，导入包重建为 Frame / Text / Rectangle / Image（crop 矩阵），保留 `pluginData.d2cNodeId`；manifest 声明零网络访问 |
| `apps/server` | Run 管理、上传 API、SSE 事件流、LLM / 视觉模型 / Figma 回写三个代理路由 |
| `apps/web` | 单列分区块 Agent 工作台、SpecRenderer、TraceFeed（轨迹分组）、DiffView、ChatPanel、SettingsPopover、FigmaPatchPanel |
| `examples/figma-bundles/product-grid` | 主 fixture：4 张商品卡 + 5 SDS 组件实例 + 12 typography |
| `examples/figma-bundles/form-page` | 第二 fixture：表单 + Input + Checkbox（未映射）+ Button |
| `examples/activity-pages` | 5 个黄金样例 fixture：campaign / summer-form 演示骨架 + 三个真实手机截图样例（activity-spec.json + 整页图集 reference.jpg + 预生成 figma-import.json） |
| `examples/sample-design-system` | 企业设计系统样本：6 个真 React 组件 + Storybook + Code Connect，供 asset-indexer 扫描 |
| `scripts/consistency.test.ts` | 浏览器本地真实执行 ≡ 服务端 SSE，逐字段 deepEqual |

完整产品设计、边界和后续真实 Agent 路径见 [D2C Agent Workbench 设计](docs/superpowers/specs/2026-08-24-d2c-agent-workbench-design.md)。面试现场讲解见 [10 分钟 Demo 脚本](docs/demo-script.md)；JD 映射见 [JD 映射文档](docs/jd-mapping.md)。

## 安全边界

- 拒绝 ZIP Path Traversal、绝对路径与超限压缩包。
- 使用 Zod 验证全部跨模块数据，不直接信任 Figma 或 Agent 输出。
- Demo 只读取内置 SDS 资产，不执行上传内容中的代码。
- 真实代码仓库接入将使用独立 Workspace、命令允许列表和 Artifact 边界。
- **PRODUCTION 服务端注册**：客户端只允许传 `sampleId`，目标 Profile（commands / repositoryPath / allowedWriteGlobs）从 `apps/server/src/profiles.ts` 解析，**绝不**接受客户端注入的命令数组；POST 时 mappings / referenceNodes 经 Zod 严格校验后入库，非法输入直接 400。
- **PRODUCTION 命令子进程 env 白名单**：仅继承 PATH / Node / HOME 等必要键，敏感环境变量不泄漏给目标仓库命令。
- LLM key 仅存浏览器 localStorage（设置面板），代理通过 `X-LLM-Key` 请求头转发，仓库 / 日志 / 下载报告均不含 key。
- **语义评审凭证只在服务端请求生命周期内**：MiniMax key 从 `.env`（已 gitignore）读取，不进 Run / Artifact / 前端响应与日志；失败回退注册基准分并如实标注 provider。
- **Figma 导入插件零网络**：manifest `networkAccess.allowedDomains` 为空，插件不发起任何请求、不读取 PAT / 文件系统；唯一输入是用户显式选择的本地 JSON 导入包。
- 真实样例的原始截图只作为本地演示素材与评测参考（随 fixture 提交），不上传任何第三方存储。
- Figma PAT 与 LLM key 同模式：仅存 localStorage，代理通过 `X-Figma-Token` 请求头转发，仓库 / 日志 / 下载报告 / 响应体均不含 PAT（测试钉死）。

## 设计参考

方案参考了 [Figma Plugin Samples](https://github.com/figma/plugin-samples)、[Figma SDS](https://github.com/figma/sds)、[Figma Code Connect](https://github.com/figma/code-connect)、[Raw JSON Exporter](https://github.com/kasper573/figma-plugin-raw-json-exporter) 与 [DesignFit](https://github.com/as9978/designfit) 的公开思路。当前实现为独立编写，未复制第三方源码。
