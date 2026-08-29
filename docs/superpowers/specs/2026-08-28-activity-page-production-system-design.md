# D2C + AI Design：复杂活动页生产系统设计

> 日期：2026-08-28
>
> 状态：设计方案
>
> 目标：将当前 D2C Agent Workbench 从可演示 Demo 升级为可在团队内试用的复杂活动页生产系统。

## 1. 执行摘要

系统接收活动页参考图、原始视觉资产、PRD 和目标代码仓库上下文，恢复截图背后的布局与设计语义，生成可编辑原型和真实 React 代码，在隔离工作区完成构建与多视口渲染，通过客观指标和多模态评审定位差异，再以最小文件补丁进行最多三轮局部修复。

完整链路为：

```text
Reference Image / Assets / PRD / Target Repository
                         ↓
                    Input Ingest
                         ↓
       Visual Understanding + Project Inspection
                         ↓
                  ActivitySpec v2
                         ↓
        Token Binding + Component Retrieval
                         ↓
          ┌──────────────┴──────────────┐
          ↓                             ↓
   Editable Prototype              Code Plan
      via Puck                          ↓
                                  Code Generation
                                          ↓
                                Isolated Build + Render
                                          ↓
                         Objective Eval + VLM Semantic Judge
                                          ↓
                         Region Localization + Error Attribution
                                          ↓
                         Typed Targeted Patch, max 3 rounds
                                          ↓
          ┌───────────────────────────────┴────────────────┐
          ↓                                                ↓
   React Production Output                     Editable Figma Export
```

关键设计决策：

1. **ActivitySpec v2 是唯一事实源。** 原型、代码、评测和修复不能由多套 Agent 分别维护。
2. **首版聚焦一个 React + TypeScript 试点仓库。** 设计适配接口，但不宣称支持任意仓库。
3. **视觉模型负责提出结构假设，客观工具负责测量结果。** VLM 不单独决定是否通过。
4. **Repair 是区域化、类型化、最小化补丁。** 不允许用“整页重新生成”代替归因与修复。
5. **优先集成开源能力。** 复用 screenshot-to-code 的视觉工具环、Puck 的编辑器、Playwright 的渲染、looks-same/Jimp/Tesseract.js 的客观指标、Code Connect/ts-morph 的映射和变更能力。

## 2. 背景与问题定义

### 2.1 当前项目已有基础

当前仓库已经具备：

- 基于 Zod 的结构化 Contracts。
- Figma Bundle 安全导入和 UISpec 归一化。
- 组件与 Token 索引、基础组件匹配。
- Orchestrator 状态流和 Trace 展示。
- 代码生成、Evaluator、EditOps 和 Figma Patch 的模块边界。
- React 工作台、两套 Fixture、Replay/Demo 流程和较完整的单元测试。

这些模块应作为生产升级的骨架继续保留，不重写整个系统。

### 2.2 当前 Demo 与生产系统之间的真实缺口

当前实现不能直接视为生产闭环：

- Codegen 主要输出 JSX 骨架和 Token CSS，没有完整布局、真实路由接入和目标仓库文件变更。
- `BUILT` 更接近演示 Trace，而不是隔离工作区内真实执行的 install/typecheck/build/render。
- Visual Fidelity 主要由预置风格和 Token 漂移公式推导，不是参考图与渲染图的实际比较。
- Evaluator 的部分常量围绕现有 Fixture 调优，缺少独立活动页基准集。
- Component Matcher 偏名称匹配，尚未充分使用 Props、Story、Code Connect、历史用法和语义证据。
- 截图理解是一次 VLM 调用，缺少 OCR、资产分割、布局约束、证据与置信度模型。
- Repair 是统一 Token 调整，不是区域定位后的文件级最小补丁。
- `SpecRenderer` 包含面向当前 Fixture 的渲染逻辑，不能作为通用活动页渲染器。

本方案的目标不是包装这些缺口，而是逐步用真实能力替换演示实现，同时保持现有 Demo 可运行。

### 2.3 为什么复杂活动页高保真还原困难

截图只包含最终像素，生产代码还需要恢复不可直接观测的隐藏变量：

- DOM 与组件层级。
- Normal Flow、Flex、Grid、Absolute、Sticky、Fixed 等布局机制。
- 宽高、对齐、间距、约束、断点与响应式规则。
- Design Token、字体度量、圆角、阴影、渐变和混合效果。
- z-index、overflow、mask、裁切与素材定位。
- 组件语义、Props、交互状态与可访问性。
- 图片、SVG、字体和动态图形等原始资产。

因此任务本质是：

```text
Pixels → latent layout semantics → reusable components → maintainable code
```

这是一个信息不完备的逆问题。系统必须显式保存“事实、推断、置信度和未知项”，而不是让模型把不确定性隐藏在生成代码中。

## 3. 产品目标、范围与成功标准

### 3.1 目标用户

- 活动页前端工程师：希望从设计参考快速得到可维护的页面初稿。
- 设计师：希望检查还原效果并在可编辑原型中调整内容和布局。
- D2C/平台团队：希望获得可追踪、可评测、可回放的生成闭环。

### 3.2 一期范围

- 页面类型：复杂营销活动页、专题页和商品活动落地页。
- 输入：一张桌面端全页参考图、原始图片/SVG/字体资产、PRD、一个已配置的目标仓库。
- 目标技术栈：React + TypeScript；样式方案由目标仓库 Profile 指定。
- 输出：ActivitySpec、Puck 可编辑原型、真实代码变更、桌面与移动端渲染、评测报告、修复记录、Figma 可编辑导入包。
- 执行：目标仓库副本或 Git worktree 中的隔离构建，不直接修改用户工作区。
- 修复：最多三轮，每轮只允许修改归因涉及的节点和文件。

### 3.3 一期明确不做

- 任意前端框架、任意未知仓库的一键生成。
- 登录、数据权限、多人协同、发布平台和在线数据库。
- 自动实现复杂业务接口、状态机和后端逻辑。
- 从单张桌面截图准确恢复所有移动端设计意图。
- 直接通过 Figma REST API 创建完整可编辑设计文件。
- 把整套 screenshot-to-code、Onlook 或其他大型产品前端嵌入当前工作台。
- 通过无限 Agent 重试掩盖无法归因的问题。

### 3.4 成功标准

团队可用 MVP 必须满足：

1. 对内部黄金活动页集合完成端到端真实运行，不使用硬编码评分。
2. 生成代码能在隔离环境通过目标仓库的 typecheck 和 build。
3. 桌面端视觉总分达到 90，移动端无溢出和 P0 布局错误。
4. 页面主要区块能映射到 ActivitySpec 节点、目标文件和评测区域。
5. Repair 能证明“定位区域 → 分类 → 最小 Patch → 分数提升”，而非整页重生成。
6. 可展示组件复用率、Token 使用率、绝对定位比例、硬编码比例和代码复杂度。
7. 用户可在 Puck 原型中修改文本、图片、顺序、间距和有限布局属性，并同步到 ActivitySpec 与代码。
8. 每个 Run 都可以通过保存的 Artifact 重放、审计和复现。

## 4. 总体架构

### 4.1 逻辑组件

```text
┌──────────────────────────────── Workbench Web ───────────────────────────────┐
│ Input │ Structured Understanding │ Prototype │ Code Diff │ Eval │ Trace     │
└──────────────────────────────────────┬────────────────────────────────────────┘
                                       │ SSE / HTTP
┌──────────────────────────────────────▼────────────────────────────────────────┐
│ TypeScript Core                                                               │
│ Orchestrator │ Contracts │ Inspector │ Matcher │ Codegen │ Eval │ Repair     │
└───────────┬───────────────────────┬───────────────────────────────┬───────────┘
            │                       │                               │
            ▼                       ▼                               ▼
  Visual Draft Sidecar      Isolated Run Workspace         Artifact Store
  Provider / OCR / Assets   Build / Render / Source Map    JSON / PNG / Diff
            │                       │
            └─────────────── ActivitySpec v2 ──────────────────────┘
```

### 4.2 运行时边界

- **TypeScript Core**：保留现有 Monorepo，负责状态机、Schema、项目检查、组件检索、代码计划、写文件、构建、评测、归因和修复。
- **Visual Draft Sidecar**：Python 服务，只封装视觉模型 Provider、截图理解、资产提取和工具调用。通过窄 HTTP Contract 返回 ActivitySpec Draft 和 Evidence；不维护第二套工作流状态。
- **Isolated Workspace**：每个 Run 复制预设目标仓库或创建 worktree，只允许在批准的目录和命令集合内写入与构建。
- **Artifact Store**：一期使用本地文件系统，不引入数据库、Redis 或消息队列。

### 4.3 模块变更

| 当前模块 | 决策 | 生产升级内容 |
|---|---|---|
| `packages/contracts` | 保留并升级 | 增加 ActivitySpec v2、Evidence、SourceMap、Eval、Violation、PatchPlan Schema |
| `packages/figma-importer` | 保留 | 继续支持结构化 Figma 输入；与截图输入统一到 ActivitySpec |
| `packages/ui-compiler` | 保留并升级 | 从简单 UISpec 转换升级为布局、视觉语义、响应式和证据归一化 |
| `packages/asset-indexer` | 保留并升级 | 增加 Code Connect、Storybook、Props、Token、历史用法和仓库 Profile |
| `packages/component-matcher` | 保留并升级 | 多阶段召回、排序、证据、阈值和人工确认 |
| `packages/codegen` | 重点替换 | 生成 CodePlan、真实文件、样式、资产和 SourceMap；不再只返回字符串片段 |
| `packages/evaluator` | 重点替换 | 使用真实截图、DOM 几何和代码分析；移除 Fixture 校准常量 |
| `packages/orchestrator` | 保留并升级 | 对接真实 Artifact、重试、恢复、修复预算和人工闸门 |
| `packages/canvas-ops` | 保留并升级 | EditOps 变成 ActivitySpec 的标准 Patch 协议 |
| `packages/figma-patcher` | 保留 | 结构化 Figma 输入仍支持安全回写；截图路径新增 Figma 导出适配器 |
| `apps/web` | 渐进升级 | 集成 Puck 编辑器、真实预览、区域 Diff、归因和 Patch Timeline |
| `apps/server` | 保留并升级 | Run API、SSE、Workspace 服务、Visual Sidecar Adapter |

### 4.4 Run 目录

```text
runs/<run-id>/
├── input/
│   ├── reference.desktop.png
│   ├── assets/
│   ├── prd.md
│   └── target-profile.json
├── evidence/
│   ├── ocr.json
│   ├── asset-candidates.json
│   └── visual-observations.json
├── spec/
│   ├── activity-spec.v2.json
│   └── patches/
├── workspace/
├── source-map/
│   └── d2c-source-map.json
├── renders/
│   ├── desktop.png
│   ├── mobile.png
│   └── dom-geometry.json
├── diffs/
│   ├── desktop.diff.png
│   └── clusters.json
├── eval/
│   ├── report.json
│   └── report.md
├── patches/
│   ├── round-1.plan.json
│   └── round-1.diff
├── trace.jsonl
└── output/
    ├── code.patch
    ├── figma-import.zip
    └── delivery-report.md
```

## 5. 输入协议与项目 Profile

### 5.1 Reference Bundle

```ts
interface ReferenceBundle {
  referenceImages: Array<{
    id: string;
    viewport: { width: number; height?: number };
    path: string;
    kind: "full-page" | "section";
  }>;
  assets: Array<{
    path: string;
    mimeType: string;
    semanticHint?: string;
  }>;
  prd: {
    path: string;
    locale: string;
  };
  targetProfile: TargetProjectProfile;
}
```

一期要求至少有一张桌面端全页图。若没有移动端参考图，系统只能检查响应式工程质量和溢出，不得声称移动端像素级还原。

### 5.2 Target Project Profile

```ts
interface TargetProjectProfile {
  repositoryPath: string;
  framework: "react";
  language: "typescript";
  packageManager: "pnpm" | "npm" | "yarn";
  routeEntry: string;
  generatedRoot: string;
  assetRoot: string;
  styleStrategy: "css-modules" | "tailwind" | "styled-components" | "plain-css";
  commands: {
    install?: string[];
    typecheck: string[];
    build: string[];
    dev: string[];
  };
  previewUrl: string;
  allowedWriteGlobs: string[];
  designSystemRoots: string[];
  tokenRoots: string[];
  storybookRoots?: string[];
  codeConnectRoots?: string[];
}
```

Profile 必须由团队维护或显式确认。系统不会自动执行从未知仓库猜出的命令。

## 6. ActivitySpec v2

### 6.1 设计目标

ActivitySpec 需要同时承载：

- 页面视觉结构。
- 布局和响应式约束。
- 组件和 Token 绑定。
- 资产、文字和交互语义。
- 每项结论的来源、置信度和替代候选。
- 原型、代码、DOM、评测区域之间的稳定映射。

### 6.2 核心结构

```ts
interface ActivitySpecV2 {
  version: "2.0";
  page: {
    id: string;
    name: string;
    route: string;
    canonicalViewport: { width: number; height: number };
    background: PaintSpec;
  };
  breakpoints: BreakpointSpec[];
  tokens: TokenBinding[];
  assets: AssetBinding[];
  nodes: ActivityNode[];
  interactions: InteractionSpec[];
  unresolved: UnresolvedDecision[];
}

interface ActivityNode {
  id: string;
  parentId?: string;
  role: "page" | "section" | "container" | "text" | "image" | "icon" | "component" | "decoration";
  name: string;
  sourceBox: Rect;
  layout: LayoutSpec;
  responsive: ResponsiveConstraint[];
  visual: VisualSpec;
  content?: ContentSpec;
  component?: ComponentBinding;
  tokenRefs: string[];
  evidence: EvidenceRef[];
  confidence: number;
  reviewState: "accepted" | "needs-review" | "rejected";
  children: string[];
}
```

### 6.3 LayoutSpec

```ts
interface LayoutSpec {
  mode: "flow" | "flex" | "grid" | "absolute" | "sticky" | "fixed";
  direction?: "row" | "column";
  align?: string;
  justify?: string;
  gap?: LengthValue;
  padding?: EdgeValues;
  width: SizeRule;
  height: SizeRule;
  minMax?: MinMaxRule;
  position?: PositionRule;
  zIndex?: number;
  overflow?: "visible" | "hidden" | "clip" | "auto";
  rationale: string;
}
```

系统必须区分装饰性 absolute 与结构性 absolute。工程指标中的绝对定位比例只惩罚结构性节点，不惩罚合理的活动页装饰层。

### 6.4 VisualSpec

VisualSpec 至少包含：

- Font family、font size、weight、line height、letter spacing、alignment。
- Solid、gradient、image fill、opacity 和 blend mode。
- Border、radius、shadow、blur、mask、clip-path。
- 图片 object-fit、object-position 和裁切框。
- Token 绑定和无 Token 时的原始值。

### 6.5 Evidence 与不确定性

```ts
interface EvidenceRef {
  type: "pixel" | "ocr" | "prd" | "asset" | "repository" | "user" | "agent";
  sourceId: string;
  region?: Rect;
  observation: string;
  confidence: number;
}
```

规则：

- PRD 和用户明确输入优先于 OCR 推断。
- 仓库已存在的 Token/组件优先于视觉模型新造的名称。
- 低于 0.55 的组件绑定不得静默自动采用。
- 冲突信息写入 `unresolved`，在 Code Planning 前进入人工确认或降级策略。
- 所有 VLM 输出必须通过 Zod 校验；失败时允许一次带错误路径的结构化重试。

### 6.6 稳定节点 ID 与 Source Map

生成 DOM 必须包含：

```html
<section data-d2c-node-id="hero.offer-panel">...</section>
```

同时生成：

```ts
interface SourceLocator {
  nodeId: string;
  file: string;
  componentName?: string;
  jsxRange?: { start: number; end: number };
  styleFile?: string;
  styleSelector?: string;
  assetPaths?: string[];
}
```

这是 DOM 几何、Diff 区域、错误类型和源代码补丁能够闭环的关键契约。

## 7. 结构化理解流水线

### 7.1 步骤

```text
Input Validation
→ Image Normalization
→ OCR + Text/Region Detection
→ Asset Fingerprinting and Matching
→ Visual Draft Agent
→ Layout Constraint Inference
→ PRD Merge
→ ActivitySpec Validation
→ Uncertainty Review
```

### 7.2 Visual Draft Sidecar

复用 `abi/screenshot-to-code` 的后端 Provider、Agent Tool Calling、资产提取和截图预览思路，但不复用其前端，也不让它直接写最终生产仓库。

Sidecar 仅开放：

```text
POST /v1/visual-draft
POST /v1/asset-extract
POST /v1/semantic-review
```

返回值必须是结构化 ActivitySpec Draft 或 Semantic Review，不接受自由文本作为核心产物。

### 7.3 资产匹配

资产流程：

1. 使用 Sharp 统一尺寸、色彩空间和透明通道。
2. 对源资产生成 SHA-256、尺寸、透明度、pHash 和可选 CLIP embedding。
3. 对参考图中的候选区域建立裁切 Evidence。
4. 先按尺寸比例、透明度和 pHash 召回，再由 VLM 判断语义与裁切方式。
5. 匹配成功时生成真实资产引用和 object-position，不将大图转为 base64。
6. 未匹配时标记 `ASSET_MISSING`，允许占位但必须降低验收状态。

### 7.4 布局推断

布局推断不是简单把所有元素写成绝对定位：

- 优先从对齐线、重复间距和共同父框推断容器。
- 重复卡片优先推断 Grid/Flex 和组件列表。
- 结构区块使用 Normal Flow；跨区装饰、角标和背景元素才使用 Absolute。
- 从页面宽度和内容最大宽度推断 `max-width` 与居中容器。
- 对不确定的断点规则使用目标仓库约定和保守响应式策略，并标明来源。

## 8. 组件检索与 Design Token 绑定

### 8.1 Project Inspector

扫描内容：

- Package exports 与组件源码。
- TypeScript Props、联合类型和默认值。
- Storybook Stories 和示例。
- Figma Code Connect 映射。
- CSS Variables、Token JSON、Tailwind Theme。
- 目标仓库中真实组件调用。
- 路由、页面骨架、SEO 和埋点约定。

Inspector 输出版本化索引，并记录 Git commit hash。索引只在仓库版本变化时重建。

### 8.2 多阶段检索

```text
Exact Mapping / Code Connect
→ Name and Export Recall
→ Props and Variant Compatibility
→ Story / Usage Semantic Recall
→ Visual Role Re-ranking
→ Confidence Gate
```

建议排序分数：

```text
score =
  0.30 × explicit_mapping
+ 0.20 × props_compatibility
+ 0.15 × name_similarity
+ 0.15 × story_semantics
+ 0.10 × historical_usage
+ 0.10 × visual_role
```

显式 Code Connect 映射存在时直接进入高优先级候选，但仍校验 Props 和 Variant。

### 8.3 置信度策略

- `>= 0.80`：自动采用，并保存证据。
- `0.55–0.79`：允许生成，但标记 Review。
- `< 0.55`：必须人工选择或创建局部页面组件。
- 无合适候选：允许生成 page-local 组件，不能污染公共 Design System。

### 8.4 Token 绑定

Token 匹配顺序：语义名 → 已有组件使用 → 数值近邻 → 新增局部 CSS 变量。

系统不能为了提高 Token 使用率把明显不匹配的颜色或间距强行吸附到现有 Token。超过容差时使用页面局部变量并报告 Token Gap，交由设计系统团队决定是否沉淀。

## 9. 可编辑原型与 Figma 输出

### 9.1 Puck 原型

使用 [Puck](https://github.com/puckeditor/puck) 作为嵌入式 React 可视化编辑层：

- ActivitySpec Node Role 映射为 Puck Component Config。
- ActivitySpec 实例映射为 Puck Data。
- 用户编辑文本、图片、顺序、显示状态和允许的布局属性。
- Puck change 不直接修改源码，而是生成类型化 EditOps 并更新 ActivitySpec。
- 更新后的 ActivitySpec 触发局部 Code Plan 和重建。

Puck 不负责像 Figma 一样的自由矢量绘制；一期把它定位为内容和布局原型编辑器。

### 9.2 Figma 导出

截图路径下的 Figma 输出采用：

```text
Canonical React Render
→ HTML/CSS/Asset Snapshot
→ html-to-figma JSON
→ Bundled Figma Plugin
→ Editable Figma Nodes
```

复用 [BuilderIO/figma-html](https://github.com/BuilderIO/figma-html) 的 HTML-to-Figma 数据格式与转换思路。Figma Plugin 是必要边界，因为公共 REST API 不能用来创建完整设计节点树。

验收关注：

- 文本可编辑。
- 图片保持 Fill/Crop 语义。
- 主要区块形成合理 Frame 层级。
- 适合的容器使用 Auto Layout。
- 节点保留 `d2cNodeId` Plugin Data，能关联 ActivitySpec。

Figma 输出是从规范 React Render 导出的投影，不允许重新调用 VLM 单独生成另一份设计，以免与代码分叉。

## 10. Code Planning 与生成

### 10.1 CodePlan

代码生成前必须先产出可校验计划：

```ts
interface CodePlan {
  route: string;
  files: Array<{
    path: string;
    action: "create" | "modify";
    purpose: string;
    nodeIds: string[];
  }>;
  reusedComponents: ComponentBinding[];
  localComponents: LocalComponentPlan[];
  assets: AssetCopyPlan[];
  styleStrategy: string;
  risks: string[];
}
```

CodePlan 校验：

- 路径必须命中 `allowedWriteGlobs`。
- 不得修改 lockfile、构建配置或公共组件，除非 Profile 明确允许且用户确认。
- 所有 ActivitySpec 主要节点都必须有生成目标。
- 所有引用资产都必须存在或有明确缺失状态。

### 10.2 生成策略

- AST 级修改使用 `ts-morph`，避免基于正则编辑 TSX。
- 样式修改根据目标仓库 Profile 选择 CSS Modules、Tailwind 或现有方案。
- 首次生成允许创建页面局部组件；Repair 优先修改现有结构，不随意拆分文件。
- 每个主要 DOM 节点写入稳定 `data-d2c-node-id`。
- 文本、素材和视觉常量必须可追溯到 ActivitySpec 或 Token Binding。
- 生成后进行 Prettier/仓库格式化，但只格式化本次涉及文件。

### 10.3 隔离工作区

```text
prepare workspace
→ apply CodePlan
→ install only if required
→ typecheck
→ build
→ start preview server
→ Playwright render
→ collect DOM geometry
```

每个命令有超时、输出上限和明确工作目录。构建失败时保留 stdout/stderr Artifact，并进入 Build Repair，不伪造 `BUILT` 事件。

## 11. 真实构建与渲染

### 11.1 固定渲染环境

- Playwright Chromium 固定版本。
- 固定 OS 字体集合或容器镜像。
- 禁用动画和 transition，冻结时间和随机数。
- 等待字体、图片和页面 `data-d2c-ready=true`。
- 固定 DPR、色彩方案和 viewport。
- 拦截非白名单网络请求，避免外部资源漂移。

### 11.2 视口

一期默认：

- Desktop：参考图原始宽度；若未知使用 1440。
- Mobile：390 × 844，用于响应式工程验收。
- 可选 Section Crop：针对超长页面降低整图 Diff 的噪声。

### 11.3 DOM 几何采集

对所有带 `data-d2c-node-id` 的节点采集：

- Bounding box、computed style、scroll size。
- visibility、overflow、z-index、position。
- 字体度量、背景、颜色、间距。
- 父子关系和实际 stacking context。

## 12. 评测系统

### 12.1 原则

- 工程指标负责客观、可复现的硬约束。
- 图像指标负责像素与感知差异。
- VLM 负责语义判断、区域解释和修复建议。
- VLM 不得覆盖 Build 失败、文字缺失、严重布局错位等硬错误。

### 12.2 硬门槛

任一项失败则不能标记 `COMPLETED`：

- Typecheck 通过。
- Build 通过。
- 页面加载成功且无未处理运行时错误。
- 主要节点存在，页面不是空白或错误页。
- 关键素材无缺失。
- Mobile 不出现整体横向溢出。
- 没有 P0 Violation。

### 12.3 Visual Fidelity

| 子指标 | 权重 | 实现 |
|---|---:|---|
| Layout Geometry | 30% | 节点 BBox、对齐、距离、IoU、父子关系 |
| Pixel/Perceptual Diff | 25% | looks-same / pixel diff，输出区域聚类 |
| Text Consistency | 15% | OCR 文本、顺序、缺失、字号和换行 |
| Color and Effects | 10% | 区域主色、背景、边框、阴影和渐变近似 |
| Asset Consistency | 10% | pHash、尺寸比例、裁切和 object-position |
| Semantic VLM Review | 10% | 主视觉层级、氛围、明显语义错配 |

对超长活动页先按主要 Section 分段评分，再按面积和业务重要性聚合，避免小范围高差异被整页平均稀释。

### 12.4 Engineering Quality

| 指标 | 说明 |
|---|---|
| Build Success | typecheck/build/runtime gate |
| Component Reuse | 可复用节点中采用现有组件的比例 |
| Token Usage | 可 Token 化值中使用现有或已声明局部 Token 的比例 |
| Structural Absolute Ratio | 结构性节点采用 absolute 的比例 |
| Hardcode Ratio | 无来源的颜色、间距、字体、尺寸常量比例 |
| Responsive Behavior | 断点布局、溢出、可读性与点击目标 |
| Semantic HTML | section/header/nav/button 等语义结构 |
| Accessibility | alt、label、contrast、keyboard 基础检查 |
| Code Complexity | 文件大小、嵌套深度、重复结构和 lint/typecheck |

### 12.5 总分和优先级

```text
Final Score = 0.70 × Visual Fidelity + 0.30 × Engineering Quality
```

- `>= 90` 且无 P0/P1：通过。
- `85–89.9`：Needs Review，可交付人工继续调整。
- `< 85`：未通过，若仍有 Repair Budget 则进入修复。

Violation 优先级：

- P0：无法构建、白屏、关键区块缺失、主要素材缺失。
- P1：主结构错位、标题/价格/CTA 错误、严重响应式溢出。
- P2：明显字体、颜色、间距、裁切或组件选择错误。
- P3：轻微像素、阴影、圆角或装饰偏差。

### 12.6 建议开源实现

- [looks-same](https://github.com/gemini-testing/looks-same)：感知 Diff、Diff Bounds 和 Cluster。
- [Jimp pHash](https://github.com/jimp-dev/jimp)：图片资产感知哈希和 Hamming Distance。
- [Tesseract.js](https://github.com/naptha/tesseract.js)：OCR 一致性。
- [Playwright](https://github.com/microsoft/playwright)：固定环境截图、DOM 几何和运行时检查。
- [Design2Code](https://github.com/NoviScl/Design2Code)：仅参考 Block/Text/Position/Color 等评测维度，不复制其研究代码或数据。

## 13. Error Attribution

### 13.1 Violation Contract

```ts
interface Violation {
  id: string;
  severity: "P0" | "P1" | "P2" | "P3";
  type: "build" | "layout" | "style" | "asset" | "text" | "component" | "responsive";
  region?: Rect;
  nodeIds: string[];
  sourceLocators: SourceLocator[];
  expected: unknown;
  actual: unknown;
  evidence: EvidenceRef[];
  confidence: number;
  suggestedAction?: string;
}
```

### 13.2 归因算法

```text
Diff Pixel Clusters
→ merge nearby rectangles
→ overlap with DOM node bounding boxes
→ rank candidate nodes by overlap, z-index and semantic importance
→ compare computed style / text / asset fingerprints
→ classify violation type
→ resolve node through Source Map
→ ask VLM to explain ambiguous region only
```

分类规则示例：

- 多个兄弟节点共同平移：父容器 `layout_error`。
- 单节点位置正确但颜色/阴影偏差：`style_error`。
- BBox 正确但图像内容或裁切不同：`asset_error`。
- OCR 内容、换行或字体度量不同：`text_error`。
- 结构和 Props 均不符合预期组件语义：`component_error`。
- 只在移动端溢出或顺序错误：`responsive_error`。

VLM 只能在已有 Region、DOM 和指标 Evidence 上做判定，不能凭整页印象直接生成全局改写建议。

## 14. Targeted Repair Loop

### 14.1 流程

```text
Render
→ Diff Detection
→ Region Localization
→ Error Classification
→ Patch Plan
→ Scope Validation
→ Apply Typed Patch
→ Typecheck + Build + Render
→ Compare Before/After
```

### 14.2 PatchPlan

```ts
interface PatchPlan {
  round: number;
  targetViolationIds: string[];
  expectedImprovement: string;
  operations: Array<
    | SpecPatchOperation
    | TsxAstOperation
    | CssOperation
    | AssetOperation
  >;
  allowedFiles: string[];
  rollbackArtifact: string;
}
```

### 14.3 补丁执行原则

- Layout 推断本身错误：先修 ActivitySpec，再重新投影受影响代码。
- 代码偏离正确 Spec：只修代码，不污染 Spec。
- 文本或素材输入错误：修 Content/Asset Binding，再更新原型和代码。
- AST 修改使用 ts-morph；CSS 使用解析器或目标样式方案的安全编辑器。
- 单轮 Patch 只能触达 `allowedFiles`，默认不超过 5 个文件。
- 每轮保留 Git diff、前后截图和分数变化。
- 补丁导致 Build 失败时立即回滚到该轮前 Artifact。

### 14.4 停止条件

- 达到通过阈值。
- 达到三轮修复上限。
- 连续两轮总分提升小于 1 分。
- 新增 P0/P1，或修改范围超出页面边界。
- 归因置信度低于 0.55，需要人工确认。
- 缺少原始素材或字体，继续修复无法取得有效进展。

## 15. Orchestrator 状态机

```text
CREATED
→ INPUT_VALIDATED
→ PROJECT_INSPECTED
→ VISUAL_DRAFTED
→ SPEC_VALIDATED
→ MAPPINGS_RESOLVED
→ CODE_PLANNED
→ GENERATED
→ TYPECHECKED
→ BUILT
→ RENDERED
→ EVALUATED
→ ATTRIBUTED
→ REPAIR_PLANNED
→ REPAIR_APPLIED
→ TYPECHECKED ...
→ COMPLETED / NEEDS_REVIEW / FAILED
```

每个状态写入不可变 Artifact 引用。服务重启时从最后一个校验通过的 Artifact 恢复。重试不得覆盖旧产物，必须增加 attempt 编号。

建议保留两个逻辑 Agent：

- Build Agent：理解、检索、计划、生成和修复。
- Eval Agent：只读取输入、渲染、DOM 和代码指标，独立输出 Violation。

Eval Agent 不读取 Build Agent 的自我评价，降低确认偏误。

## 16. Workbench 交互设计

### 16.1 信息架构

```text
┌─────────────────────┬────────────────────────┬────────────────────────────┐
│ Input & Structure   │ Prototype / Live Page  │ Eval & Repair              │
│ Reference           │ Puck Edit              │ Scorecard                  │
│ Assets / PRD        │ Desktop / Mobile       │ Diff Overlay               │
│ ActivitySpec Tree   │ Component Boundaries   │ Violation List             │
│ Mapping Evidence    │ Code Selection         │ Patch Timeline / Trace     │
└─────────────────────┴────────────────────────┴────────────────────────────┘
```

### 16.2 关键交互

- Reference 与 Render 叠加滑杆、闪烁对比和 Diff 热区。
- 点击 Diff Region，高亮 ActivitySpec Node、DOM 节点和代码 Source Locator。
- 低置信度组件映射显示候选、Props 差异和真实 Story 示例。
- Repair Plan 在执行前展示涉及文件、目标 Violation 和预计影响。
- Puck 编辑后先显示 ActivitySpec Patch，再执行代码同步。
- 每轮修复展示前后分数、截图和代码 Diff。
- Final Delivery 展示通过项、未解决问题和可下载产物。

## 17. 安全、稳定性与成本

### 17.1 安全边界

- 输入 ZIP 防 Path Traversal，并限制文件数、单文件和总体积。
- 只允许读取 Profile 声明的仓库目录。
- 只允许写入 Run Workspace 中的 `allowedWriteGlobs`。
- 子进程使用参数数组，不拼接 Shell 字符串；命令来自 Profile 白名单。
- 禁止默认运行未知安装脚本和任意网络命令。
- Trace 脱敏 API Key、环境变量、Authorization 和 Cookie。
- Figma Patch 和导入包只生成预览，实际应用由用户确认。

### 17.2 稳定性

- Sidecar、LLM 和 VLM 调用有超时、一次结构化重试和取消信号。
- Build、Render、Eval 均有独立 Artifact Boundary。
- 浏览器崩溃只重试 Render，不重新生成代码。
- Eval 工具失败返回 `EVAL_FAILED`，不能用旧分数或默认分数代替。

### 17.3 成本控制

- OCR、图像 Diff、DOM 分析和代码指标优先使用本地工具。
- VLM 首轮看全图，Repair 只看问题 Region 和相关上下文。
- 相同参考图、资产哈希和项目索引可缓存。
- 默认最多三轮 Repair，并记录模型 Token、时间和成本。

## 18. 开源复用决策

| 项目 | 用法 | 集成方式 | 决策 |
|---|---|---|---|
| [abi/screenshot-to-code](https://github.com/abi/screenshot-to-code) | Provider、Agent 工具环、资产提取、截图预览 | Python Sidecar 中适配核心后端模块 | 复用，不引入其前端和最终代码结构 |
| [puckeditor/puck](https://github.com/puckeditor/puck) | React 可编辑原型 | `apps/web` 直接依赖 | 直接使用 |
| [BuilderIO/figma-html](https://github.com/BuilderIO/figma-html) | HTML → 可编辑 Figma 数据 | Figma Export Adapter + 自有插件 | 复用格式和转换能力 |
| [looks-same](https://github.com/gemini-testing/looks-same) | 感知 Diff、区域聚类 | Evaluator 直接依赖 | 直接使用 |
| [jimp-dev/jimp](https://github.com/jimp-dev/jimp) | pHash | Asset/Evaluator 直接依赖 | 直接使用 |
| [naptha/tesseract.js](https://github.com/naptha/tesseract.js) | OCR | Evaluator/Understanding 直接依赖 | 直接使用 |
| [microsoft/playwright](https://github.com/microsoft/playwright) | Build 后渲染与 DOM 采集 | 延续当前 E2E 基础 | 直接使用 |
| [figma/code-connect](https://github.com/figma/code-connect) | 设计组件与代码组件映射 | Project Inspector 解析 | 直接使用 |
| [dsherret/ts-morph](https://github.com/dsherret/ts-morph) | TSX AST 生成和补丁 | Codegen/Repair 直接依赖 | 直接使用 |
| [onlook-dev/onlook](https://github.com/onlook-dev/onlook) | DOM-to-code 定位、可视编辑架构参考 | 只参考架构 | 不嵌入大型产品 |
| [NoviScl/Design2Code](https://github.com/NoviScl/Design2Code) | 评测维度与基准设计参考 | 只参考论文/README 思路 | 不复制研究代码和数据 |

引入每个项目时需要锁定版本、保存许可证和 Attribution，并在法务允许范围内使用。对来源不清、许可证不明确或研究用途受限的实现，只做概念参考。

## 19. 测试与基准集

### 19.1 测试金字塔

- Unit：Schema、Evidence 合并、布局规则、检索排序、Token 绑定、SourceMap、指标计算、归因和 Patch Scope。
- Contract：TypeScript Core ↔ Python Sidecar、ActivitySpec ↔ Puck、ActivitySpec ↔ Codegen。
- Integration：Reference Bundle → Spec → Code → Build → Render → Eval。
- Golden：固定输入、ActivitySpec 和目标渲染，指标变更必须解释。
- E2E：完整 Run、人工确认、Repair、失败恢复和最终下载。
- Real Model Smoke：少量固定样例，定时执行，不进入每次 PR 的默认 CI。

### 19.2 内部活动页黄金集

首版建立 12 个页面：

- 4 个 Hero + 商品瀑布流页面。
- 3 个多层装饰和绝对定位较多的节日活动页。
- 2 个长文本/权益说明页面。
- 2 个强组件复用页面。
- 1 个刻意包含缺失素材、字体和响应式冲突的失败样例。

每个样例保存：

- 原始桌面/移动端参考图。
- 原始素材和字体许可信息。
- 人工标注 Section/BBox/Text/Asset Ground Truth。
- 目标仓库基准实现和截图。
- 允许误差、关键节点和 P0/P1 规则。

### 19.3 回归门槛

- Build pass rate 不下降。
- 黄金集 Visual Fidelity 均值下降超过 1 分时阻止合并。
- 任一关键页面下降超过 3 分时阻止合并。
- Repair 成功率、平均轮数、修改文件数和 Token 成本均纳入趋势报告。

## 20. 可观测性与交付报告

每个 Tool Call 记录：

- Run/Step/Attempt ID。
- 输入输出 Artifact ID。
- 开始时间、耗时和状态。
- 模型、Token 和估算成本。
- 修改文件、命令退出码和日志路径。
- Eval 分数与新增/解决 Violation。

最终报告包含：

- 输入和目标仓库版本。
- 组件/Token 复用情况。
- Build、Render、Visual 和 Engineering 指标。
- 每轮 Repair 的目标、Patch、分数变化和回滚情况。
- 未解决问题、风险和人工建议。
- 代码 Patch、ActivitySpec、Puck Data、Figma Import 和 Trace 下载链接。

## 21. 分阶段落地路线

### Phase 0：去掉假闭环，建立真实基线（3–5 天）

- 保留现有 UI 和 Demo Fixture。
- 为现有 `BUILT`、Visual Score 和 Repair 标识 Replay/Mock 来源。
- 建立 Run Artifact Store 和 Target Project Profile。
- 移除生产路径中的硬编码评分，补充真实与 Replay 模式区分。

验收：任何分数和 Build 状态都能追溯到真实工具结果或明确标记的 Replay Artifact。

### Phase 1：真实 Codegen + Build + Render（1–2 周）

- ActivitySpec v2 最小结构、CodePlan 和 SourceMap。
- 在一个 React + TypeScript 试点仓库生成真实页面文件。
- 隔离 Workspace、typecheck、build、preview、Playwright 截图和 DOM 采集。
- 工作台展示真实代码 Diff 和构建日志。

验收：两个黄金样例能生成、构建、渲染；失败不会被标记为成功。

### Phase 2：客观 Eval + Error Attribution（1–2 周）

- looks-same、pHash、OCR、DOM Geometry 和工程指标。
- Diff Cluster → Node → Source Locator。
- 结构化 Violation 和区域联动 UI。
- 建立首批 6 个黄金样例。

验收：人为制造的 layout/style/asset/text/component 错误能被正确定位和分类。

### Phase 3：Targeted Repair（1–2 周）

- PatchPlan、Scope Validator、ts-morph/CSS Patch Executor。
- 最多三轮修复、回滚、停止条件和前后对比。
- 区域 VLM Judge，仅用于歧义归因和建议。

验收：至少 4 类错误能通过局部补丁修复；平均每轮修改不超过 5 个文件；无整页重生成。

### Phase 4：Screenshot Understanding + Assets（2 周）

- screenshot-to-code Sidecar Adapter。
- OCR、资产指纹、区域匹配和 ActivitySpec Evidence。
- 布局语义推断与人工确认闸门。
- 黄金集扩充至 12 个页面。

验收：从截图、资产和 PRD 生成的 Spec 能解释主要布局决策，低置信度信息不会静默进入最终代码。

### Phase 5：Editable Prototype + Figma（1–2 周）

- Puck Config/Data Adapter 和 EditOps 回写。
- html-to-figma Export Adapter 与 Figma Plugin。
- 编辑后局部代码同步与重新评测。

验收：原型修改、代码和 Figma 输出共享稳定 Node ID，主要内容和布局修改不发生三方漂移。

## 22. 里程碑演示脚本

最终演示应按生产问题展开：

1. 上传复杂活动页参考图、源资产和 PRD。
2. 选择已配置的目标仓库，展示组件、Token 和 Code Connect 索引。
3. 展示 ActivitySpec 的布局推断、资产证据和低置信度项。
4. 确认一个组件候选，生成 Puck 原型和真实代码计划。
5. 在隔离 Workspace 真实执行 typecheck/build/render。
6. 展示桌面/移动端页面、DOM Node 和代码定位。
7. 展示 Pixel/Geometry/OCR/Engineering/VLM 组合评测。
8. 点击一个错误区域，解释其为何是 `asset_error` 或 `layout_error`。
9. 生成只涉及相关节点和文件的 Patch Plan。
10. 重新构建和渲染，展示分数提升与 Diff 收敛。
11. 在 Puck 中修改 CTA 文本或间距，回写 ActivitySpec 并局部更新代码。
12. 导出 Code Patch、评测报告、Trace 和可编辑 Figma 导入包。

## 23. 面试表达框架

可以用以下表述概括方案：

> 高保真 D2C 不是截图转 JSX，而是从像素反推隐藏的布局、设计和组件语义。单张截图必然存在信息损失，所以生产系统必须把事实、推断、置信度和未知项结构化。我们用 ActivitySpec 作为唯一事实源，让可编辑原型和生产代码共享同一套节点、Token 和组件绑定；生成后在隔离仓库真实构建、渲染，通过 Pixel/Geometry/OCR/工程指标和 VLM 语义评审共同定位错误。Repair 不整页重生成，而是把 Diff Region 映射到 DOM Node 和源码位置，只修改相关 Spec、组件或样式，再重新构建验证。这与图像领域通过 BBox 做局部修图是同一个工程思想。

当被追问“为什么这样做”时强调：

- VLM 擅长语义和候选判断，不擅长提供稳定、可复现的精确度量。
- 客观指标能回答“差多少”，VLM 能回答“为什么错、应该改哪里”。
- 单一 ActivitySpec 和稳定 Node ID 是原型、代码、Eval、Repair 能闭环的前提。
- 首版固定试点仓库是为了把组件复用、构建约束和工程质量做实，再逐步抽象 Adapter。

## 24. 风险与待验证假设

| 风险 | 影响 | 缓解 |
|---|---|---|
| 单张截图无法推断真实响应式规则 | 移动端可能符合工程规范但不符合设计意图 | 明确降级语义；优先要求多视口参考图 |
| 字体缺失导致全页几何漂移 | OCR、换行和布局分数异常 | 输入校验字体；固定渲染字体环境 |
| 活动页装饰大量使用 Absolute | 通用工程指标误判 | 区分结构性和装饰性节点 |
| VLM 输出不稳定 | Spec 漂移、修复方向不一致 | Schema、Evidence、缓存、固定 Prompt 和低置信度闸门 |
| Figma 导入无法完全恢复 Auto Layout | 可编辑性不足 | 以主要 Section 覆盖率验收，不承诺任意 CSS 等价转换 |
| 开源项目升级或许可证变化 | 维护和合规风险 | 锁版本、保存许可证、建立 Adapter、定期审计 |
| Repair Patch 扩散 | 引入新回归 | SourceMap、allowedFiles、最多 5 文件、每轮全量 Build/Eval |
| 目标仓库差异过大 | Adapter 复杂度快速膨胀 | 一期固定一个仓库，以 Profile 显式配置差异 |

## 25. 最终验收清单

> 2026-08-29 实施后核对：勾选项已落地并有自动化证据；未勾项如实保留差距，不做纸面完成。

- [x] ActivitySpec v2、Evidence、SourceMap、Violation、PatchPlan 均有版本化 Schema。（`packages/contracts/src/production.ts`，Zod strict + 版本字段，测试钉死）
- [x] 一个真实试点仓库完成隔离生成、typecheck、build 和 Playwright Render。（`examples/activity-target`，E2E `tests/e2e/production.spec.ts` 全链路通过，finalScore 96）
- [x] 所有生产分数来自真实 Artifact，没有 Fixture 常量或伪造 Build 事件。（`runProductionWorkflow` 每状态携带 artifactId；工程指标从 spec/code plan 推导；build 失败为 P0 硬门槛）
- [x] Desktop 和 Mobile 均有截图与 DOM Geometry。（server 渲染 desktop 1440×900 + mobile 390×844 双视口采集，落 render artifact；评测仍以 canonical 视口为准，mobile 评测维度是后续项）
- [ ] Visual Eval 同时包含 Layout、Diff、OCR、Asset 和 VLM 语义指标。**部分落地**：Layout 几何 ✓；Diff/pHash 管线就绪但默认无参考图输入（compareImages 适配器留位）；OCR 因供应链策略未装 Tesseract，文本走 PRD 结构化证据注入；VLM 语义分当前为默认值 90，未接真实视觉模型评审。
- [x] Engineering Eval 包含组件复用、Token、绝对定位、硬编码、响应式和复杂度。（`evaluateProductionRun` engineering 九维，全部从真实产物推导）
- [x] Diff Region 能定位到 ActivitySpec Node 与源码文件。（`attributeDiffClusters` 支持区域→最小节点→父容器归因并回填 SourceMap 定位；真实闭环当前由几何违规驱动归因，像素 diff 聚类归因待接参考图后启用）
- [x] Repair 使用结构化 PatchPlan，最多三轮，并保存每轮前后结果。（≤5 文件白名单校验、CSS/AST/Spec 三类补丁、每轮 rollback 快照落 artifact、连续两轮 <1 分熔断）
- [x] Puck 编辑通过 EditOps 回写 ActivitySpec，不直接产生不可追踪源码修改。（PrototypeEditor 发出 `set-content` SpecEditOp，服务端 `/edit` 消费并附 user evidence）
- [ ] Figma 输出由规范 React Render 导出，并通过插件生成可编辑节点。**部分落地**：`buildFigmaImportBundle` 从 ActivitySpec + 渲染证据生成 html-to-figma 兼容节点 JSON（保留 `pluginData.d2cNodeId`），有单测；但**插件端实际导入未做实弹验证**。
- [ ] 12 个活动页黄金集建立并进入回归测试。**未落地**：当前 1 个黄金样例（campaign）进 E2E 回归；11 个扩展集待建。
- [x] 开源依赖完成版本锁定、许可证和 Attribution 审计。（pnpm-lock 双层锁定 + allowBuilds 供应链白名单；`docs/licenses.md` 全量生产依赖审计：全部宽松许可证，无 copyleft）
- [ ] 最终交付包含代码、原型、Figma、评测、Trace 和未解决风险。**部分落地**：代码/原型/评测/Trace/Figma 导出包 ✓；"未解决风险"即本清单未勾项，本文档为权威记录。

## 26. 推荐的首个实施切片

第一刀只做：

```text
已有 Figma/UISpec Fixture
→ ActivitySpec v2 最小迁移
→ 真实 CodePlan 和试点仓库写入
→ typecheck/build
→ Playwright desktop/mobile render
→ looks-same + DOM geometry
→ 一个 layout_error 的 Node/File 归因
→ ts-morph/CSS 局部 Patch
→ 重新构建后分数提升
```

这个切片暂时不接截图理解、Puck 和 Figma 导出。它优先证明最关键、风险最高的“真实代码—构建—评测—归因—局部修复”闭环；闭环成立后，再替换输入端和增加双向设计编辑能力。
