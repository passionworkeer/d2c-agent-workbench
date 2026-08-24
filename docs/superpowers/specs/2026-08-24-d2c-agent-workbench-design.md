# D2C Agent Workbench 设计

## 1. 目标

构建一条可演示、可追踪、可评测的 D2C 链路：

```text
Figma 结构化资产
→ UI 理解与 UISpec
→ 企业组件和 Design Token 检索
→ Agent 组件匹配与代码生成
→ React 可运行页面
→ 自动评测
→ 失败归因与修复
→ Code Diff、Eval 与 Trace 交付
```

Demo 的核心不是一次性生成相似页面，而是证明系统能利用 Figma 结构、团队组件、Design Token 和代码仓库上下文，产出可维护代码，并通过独立评测闭环持续修复。

## 2. 范围

### 2.1 第一版包含

- Figma Plugin 导出结构化离线 Bundle。
- Bundle 上传、校验和预览。
- Figma Node Tree 到 UISpec 的归一化。
- 目标仓库组件、Token、Storybook 和代码约定索引。
- 组件候选检索、证据展示和人工确认。
- Build Agent 代码计划、生成和修复。
- Eval Agent 独立评测。
- React 页面构建、Playwright 渲染和代码 Diff。
- Geometry、Component Reuse、Token Compliance、Visual Fidelity、Semantic Structure 和 Code Quality 评分。
- Trace、Artifact、Replay 和结构化交付报告。
- 对话式 UISpec Patch 和安全属性范围内的 Figma Patch。

### 2.2 第一版不包含

- 原生 `.fig` 二进制解析。
- 通用拖拽画布编辑器。
- 任意前端框架生成。
- 多人实时协作、账号和云端权限系统。
- 向量数据库和通用知识库平台。
- 自动删除或大规模重建 Figma 节点。
- 对任意未知代码仓库无确认执行安装脚本。

## 3. 技术架构

使用 TypeScript Monorepo：

```text
d2c-agent-workbench/
├── apps/
│   ├── web/                 React + Vite 工作台
│   ├── server/              Fastify + SSE 编排服务
│   └── figma-exporter/      Figma 导出与 Patch 应用插件
├── packages/
│   ├── contracts/           Bundle、UISpec、Trace、Eval 的 Zod Schema
│   ├── figma-importer/      Bundle 校验与 Figma 数据归一化
│   ├── ui-compiler/         Figma Model → UISpec
│   ├── asset-indexer/       组件、Token、Storybook、代码约定索引
│   ├── component-matcher/   候选召回、排序、证据和置信度
│   ├── orchestrator/        Typed Workflow 与任务状态
│   ├── codegen/             代码计划、Workspace 修改与构建
│   ├── evaluator/           结构、Token、Geometry 和视觉评测
│   ├── trace/               JSONL Trace 与 Artifact Store
│   └── agent-adapters/      Codex CLI 和 Replay 适配器
├── skills/
│   ├── shared/
│   ├── codex/
│   └── claude/
├── examples/
│   ├── figma-bundles/
│   └── sds-target/
├── docs/
└── runs/
```

技术栈为 pnpm workspace、React、Vite、Fastify、SSE、Zod、ts-morph、Vitest 和 Playwright。第一版不引入数据库、Redis、消息队列、微服务或复杂 Agent 框架。

## 4. Figma 输入协议

用户在 Figma 中选择 Frame，通过 D2C Exporter Plugin 导出：

```text
figma-bundle.zip
├── manifest.json
├── design.json
├── variables.json
├── components.json
├── preview/
│   ├── root@2x.png
│   └── elements/
└── assets/
```

Bundle 保存 Node Tree、尺寸、Auto Layout、Hug/Fill/Fixed、Constraints、文字、Fill、Stroke、Effect、Variable Binding、Alias、Component、Instance、Variant、Component Properties、PNG、SVG 和图片资源。

只上传截图属于显式降级模式。系统必须显示结构、组件和 Token 信息不可用，不能将其标记为完整 D2C。

输入源统一为：

```ts
interface DesignSourceAdapter {
  inspect(input: unknown): Promise<DesignBundle>;
}
```

第一版实现 `FigmaBundleAdapter`，为未来的 `FigmaMcpAdapter` 和 `FigmaRestAdapter` 保留边界。

## 5. UISpec

UISpec 是 Figma 理解、组件匹配、代码生成、对话式编辑和评测共享的中间表示。节点包含：

- 稳定节点 ID、名称、节点类型和语义角色。
- 布局方向、Sizing Mode、Gap、Padding 和 Constraints。
- Figma Component、代码 Component、Props、置信度和证据。
- Fill、Typography、Radius、Effect 等 Token 引用。
- 文字、图片和 SVG 等内容资产。
- 子节点和交互信息。

UISpec Artifact 不覆盖旧版本：

```text
uispec.v1.json
uispec.v2.json
uispec.patch.1.json
```

对话式编辑先生成 UISpec Patch，再做影响分析、代码 Patch、局部 Build 和 Eval。

## 6. 企业资产索引与匹配

Asset Indexer 扫描目标代码仓库中的：

- 组件源码和 export 入口。
- TypeScript Props 和 Variant 定义。
- Storybook Stories。
- Code Connect Templates。
- Token JSON、CSS Variables 和 Tailwind 配置。
- 历史组件调用和项目代码约定。

候选召回结合名称、Figma Component 映射、Props/Variant、Storybook 描述、历史使用和语义相似度。Agent 只在候选集合上判断，不在整个仓库中盲猜。

置信度策略：

- `>= 0.80`：自动采用。
- `0.55–0.79`：采用并标记 Review。
- `< 0.55`：暂停并要求人工选择。
- 无候选：允许生成局部组件，但必须报告未复用原因。

## 7. Agent、Tools 与工作流

只拆两个 Agent：

- Build Agent：理解、检索、组件匹配、代码计划、生成和修复。
- Eval Agent：隔离上下文下独立评测。

Repair 由 Build Agent 执行，不额外创建角色。

Tools 首先实现为可测试的本地 TypeScript 函数：

```text
inspect_design
read_uispec
search_component
search_token
read_component_api
search_code_example
write_code_plan
read_target_file
write_target_file
run_typecheck
run_lint
run_build
render_page
evaluate_output
```

未来需要 MCP 时，只增加 Transport，不修改核心业务逻辑。

状态机：

```text
UPLOADED
→ VALIDATED
→ NORMALIZED
→ ASSETS_INDEXED
→ COMPONENTS_MAPPED
→ CODE_PLANNED
→ GENERATED
→ BUILT
→ EVALUATED
→ REPAIRING
→ COMPLETED / NEEDS_REVIEW / FAILED
```

## 8. Trace、Workspace 与恢复

每个 Run 使用独立目录：

```text
runs/<run-id>/
├── input/
├── artifacts/
├── trace.jsonl
├── workspace/
├── screenshots/
└── output/
```

目标仓库不被直接修改。每个步骤记录输入输出 Artifact、Tool、参数、耗时、Token Usage、Outcome 和 Error Type。服务重启后从最后一个有效 Artifact 恢复，失败节点可单独 Retry。

ReplayAdapter 使用已经保存的真实 Trace 驱动完整 UI 流程，保证面试现场断网时仍能完成演示。

## 9. 评测与修复

硬门槛：TypeScript、Build、页面加载和关键节点存在性必须通过。

评分权重：

| 指标 | 权重 |
|---|---:|
| Geometry / Layout | 25% |
| Component Reuse | 20% |
| Token Compliance | 20% |
| Visual Fidelity | 15% |
| Semantic Structure | 10% |
| Code Quality | 10% |

Geometry 比较元素存在性、Bounding Box、对齐、Gap、Padding、宽高、父子层级和相对位置。视觉评测使用固定视口截图和低权重 Pixel Diff，可选 VLM 只用于问题归因，不单独决定通过。

Repair 最多三轮，在总分 `>= 90` 且没有 P0 时通过。连续两轮无提升、达到三轮或修改超出任务边界时停止。

## 10. 错误处理

错误分类：

```text
INPUT_INVALID
ASSET_MISSING
VARIABLE_UNRESOLVED
COMPONENT_AMBIGUOUS
AGENT_TIMEOUT
AGENT_OUTPUT_INVALID
BUILD_FAILED
RENDER_FAILED
EVAL_FAILED
REPAIR_EXHAUSTED
```

- 输入错误不重试，显示具体字段路径。
- Agent 超时最多重试一次。
- Build 失败进入 Repair Loop。
- 组件歧义进入人工选择。
- Eval 工具失败标记任务失败，不伪造低分。
- 所有步骤都以 Artifact 为恢复边界。

## 11. 安全边界

- 防止 ZIP Path Traversal。
- 限制文件数、单文件和解压后总体积。
- 校验 MIME、扩展名和 JSON Schema。
- Bundle 不允许包含可执行文件。
- Demo 默认只执行内置 SDS Target。
- 外部仓库必须显式标记 Trusted，并使用命令允许列表。
- Trace 自动移除 Token、环境变量和密钥。
- 所有子进程有超时和终止机制。
- Figma Patch 必须预览并由用户确认。

## 12. Web 工作台

使用三栏布局：

```text
┌─────────────────┬─────────────────────┬──────────────────────┐
│ Design Source   │ Understanding       │ Delivery             │
│ Preview         │ Workflow Trace      │ Live Preview         │
│ Node Tree       │ Component Mapping   │ Code Diff            │
│ Tokens          │ Retrieval Evidence  │ Eval Scorecard       │
└─────────────────┴─────────────────────┴──────────────────────┘
```

支持上传 Bundle、选择 SDS Target、启动 Run、查看 UISpec、确认低置信度组件、实时查看 Trace、预览页面、查看 Code Diff 与 Eval、输入局部修改、下载 Patch、报告和 Trace，以及播放历史 Replay。

## 13. 测试

- Unit：Schema、ZIP 安全、Alias Resolution、Figma Node → UISpec、Auto Layout → Flex、候选排序、Token Compliance、Geometry Score、状态转换。
- Golden Fixture：Button、Product Card、Header、Product Grid 和 Checkout Form 的固定 Bundle 与 UISpec。
- Integration：Bundle → UISpec → SDS Component Map → React Code → Build → Render → Eval。
- E2E：Replay 模式完成上传、Trace、预览、首次失败、Repair、分数提升和报告下载。
- Real Agent Smoke：少量 Codex 实际调用，不进入默认 CI。

## 14. 开源复用

直接复用或适配 MIT 项目并保留许可证和 Attribution：

- `kasper573/figma-plugin-raw-json-exporter`
- `figma/plugin-samples`
- `figma/sds`
- `figma/code-connect`
- `as9978/designfit`

`Gamma-Software/figma-llm-export` 没有明确许可证，`bernaferrari/FigmaToCode` 为 GPL-3.0；两者只作为架构和产品参考，不复制代码到私有仓库。

## 15. Demo-first 顺序

1. 创建工作台三栏 UI、示例 Bundle 和 Replay Trace。
2. 打通上传、UISpec、固定 SDS 映射、React 预览、Eval 失败与 Repair 提升。
3. 用真实 Figma Importer、Asset Indexer、Codex Adapter 和真实 Workspace 替换预置环节。
4. 完成 Figma Exporter Plugin。
5. 完成 Geometry、Token、Component、Visual Eval 和对话式 UISpec Patch。
6. 增加 Figma Patch、CLI、共享 Skill 与 Agent 适配文档。

## 16. Demo 验收标准

现场必须完成：

1. 上传结构化 Figma Bundle。
2. 展示 Node Tree、Auto Layout、Variables 和 Preview。
3. 生成 UISpec。
4. 展示 SDS 组件匹配、置信度和证据。
5. 生成并运行 React 页面。
6. 通过 TypeScript、Build 和页面渲染。
7. 展示首轮 Eval 失败原因。
8. Repair 后分数明确提高。
9. 展示组件复用率和 Token 合规率。
10. 展示完整 Trace。
11. 对话式修改产生局部 Patch。
12. 断网时通过 Replay 完成完整演示。

