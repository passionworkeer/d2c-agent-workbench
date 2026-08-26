# D2C Agent Workbench

一个面向面试演示的、可追踪且可评测的 Design-to-Code 工作台。它把结构化 Figma 资产编译为 UISpec，基于团队设计系统匹配组件与 Design Token，再通过 Build / Eval 双 Agent 工作流完成代码生成、问题归因和自动修复；并支持参考图 / Figma → 设计稿（I2D）、LLM 可选的对话式画布编辑。

![工作台结构](https://img.shields.io/badge/Figma%20Bundle-%E2%86%92%20UISpec-c8ff38) ![组件匹配](https://img.shields.io/badge/SDS-%E7%BB%84%E4%BB%B6%E8%AF%81%E6%8D%AE-ff6433) ![评测闭环](https://img.shields.io/badge/Eval-72%E2%86%9294-c8ff38) ![LLM](https://img.shields.io/badge/LLM-MiniMax%20M3-ff6433)

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
- **对话式画布编辑**：ChatPanel 输入中文指令（如"把第二张卡片换成 lime"），画布实时刷新 + trace 实时追加 `CANVAS_EDITED` 事件。默认走规则解析（演示零风险），可选切换到真实 LLM（MiniMax Anthropic 兼容端点）。
- **LLM 不可达自动降级规则解析** + ChatPanel 提示 + toolCalls 标记 `fallback:true`，不会让演示因网络或 key 失效而中断。
- 下载包含 Run、Trace、Mapping、Evaluation（含 `resolvedViolationIds`）和 toolCalls 的结构化报告，**不含 LLM key**。

> 默认演示的 Agent 输出是浏览器内确定性管线的真实执行（产物扫描、类型化修复、LCS Diff），不是字符串 Mock。LLM 通过 `POST /api/canvas/interpret` 可选接入；key 仅存浏览器 localStorage（设置面板），仓库任何文件、下载报告与日志都不含 key。

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
                                            │
                                            ▼
                                     canvas.parseIntent (本地规则)
                                            │
                                            └─→ POST /api/canvas/interpret (LLM, X-LLM-Key)
```

| 模块 | 职责 |
|---|---|
| `packages/contracts` | Bundle、UISpec、Trace、Evaluation、EditOp 的 Zod 协议 |
| `packages/figma-importer` | ZIP 安全检查、资产解析和输入验证 |
| `packages/ui-compiler` | Auto Layout、Sizing、Token 到 UISpec |
| `packages/component-matcher` | SDS 候选召回、排序、证据和置信度 |
| `packages/codegen` | 真实 DFS 出码 + StyleRef 发射 + 类型化修复（tokenize / restore-value / define-token / snap-to-declared） |
| `packages/evaluator` | 六维加权评测、Violation DFS 序确定归因、修复对比 |
| `packages/orchestrator` | Build / Eval / Repair 状态机、Replay 与 toolCalls |
| `packages/canvas-ops` | 对话式画布编辑：`parseIntent` 中文规则 + `applyEditOps` 纯函数（set-prop / set-style / set-text / set-layout） |
| `apps/server` | Run 管理、上传 API、SSE 事件流、`POST /api/canvas/interpret` LLM 代理 |
| `apps/web` | 三栏 Agent 工作台、SpecRenderer、TraceEventCard、DiffView、ChatPanel、SettingsPopover |
| `examples/figma-bundles/product-grid` | 主 fixture：4 张商品卡 + 5 SDS 组件实例 + 12 typography |
| `examples/figma-bundles/form-page` | 第二 fixture：表单 + Input + Checkbox（未映射）+ Button |
| `scripts/consistency.test.ts` | 浏览器本地真实执行 ≡ 服务端 SSE，逐字段 deepEqual |

完整产品设计、边界和后续真实 Agent 路径见 [D2C Agent Workbench 设计](docs/superpowers/specs/2026-08-24-d2c-agent-workbench-design.md)。面试现场讲解见 [10 分钟 Demo 脚本](docs/demo-script.md)；JD 映射见 [JD 映射文档](docs/jd-mapping.md)。

## 安全边界

- 拒绝 ZIP Path Traversal、绝对路径与超限压缩包。
- 使用 Zod 验证全部跨模块数据，不直接信任 Figma 或 Agent 输出。
- Demo 只读取内置 SDS 资产，不执行上传内容中的代码。
- 真实代码仓库接入将使用独立 Workspace、命令允许列表和 Artifact 边界。
- LLM key 仅存浏览器 localStorage（设置面板），代理通过 `X-LLM-Key` 请求头转发，仓库 / 日志 / 下载报告均不含 key。

## 设计参考

方案参考了 [Figma Plugin Samples](https://github.com/figma/plugin-samples)、[Figma SDS](https://github.com/figma/sds)、[Figma Code Connect](https://github.com/figma/code-connect)、[Raw JSON Exporter](https://github.com/kasper573/figma-plugin-raw-json-exporter) 与 [DesignFit](https://github.com/as9978/designfit) 的公开思路。当前实现为独立编写，未复制第三方源码。