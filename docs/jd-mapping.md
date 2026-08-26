# JD 映射：项目模块 → 岗位要求 → 演示动作 → 讲稿要点

> 把仓库里每一段代码回挂到岗位 JD 的具体职责 / 要求上，让面试官一眼看到「读懂了 JD」。
> 表格分四列：JD 条目 → 项目模块（代码位置）→ 演示动作（点哪里）→ 讲稿要点（一句话讲清楚）

## 1. 职责 1：Agent 架构与工具调用

| JD 条目 | 项目模块 | 演示动作 | 讲稿要点 |
|---|---|---|---|
| 工具调用编排（Tool Use / Function Calling） | `packages/orchestrator/src/index.ts` `makeEvent` 携带 `toolCalls`；每个状态都记录触发的本地工具名 + 计数 | 中栏"Agent 执行轨迹"逐事件展开，看 toolCalls 行 | 多 Agent 价值不在角色数量，而在职责隔离与可验证反馈：Build / Eval / Repair 各自独立上下文，每步产出类型化 Event + toolCall，避免上下文污染 |
| 协议化 Artifact（不靠 prompt 串联） | `packages/contracts/src/index.ts` `traceEventSchema` + `toolCallSchema` + `evaluationReportSchema` | 中栏事件卡 + TraceEventCard 折叠 JSON | UISpec / TraceEvent / EvaluationReport 三个 Zod 契约跨前后端流动；改 zip 即触发链路重跑，不会出现"模型说通过但产品失败" |
| 状态机可回放 / 可恢复 | `runReplayWorkflow` AsyncGenerator + SSE 重连 + `generation` 计数器 | 点"上一步"回退；再点"下一步"前进 | 每一步独立可暂停 / 跳过；generation 单调递增防旧 run 迟到回调污染 UI |

## 2. 职责 2：Figma / 多模态 UI 理解（I2D）

| JD 条目 | 项目模块 | 演示动作 | 讲稿要点 |
|---|---|---|---|
| Figma 结构化资产解析（Auto Layout / 变量 / 组件实例） | `packages/figma-importer` + `packages/ui-compiler` | 左栏"设计输入"显示 Figma 资产预览 + 节点树 | ZIP 安全校验（路径穿越 / zip bomb / Zod 协议校验）→ 编译为 UISpec，把横向 / 纵向 Auto Layout 翻译成 `direction: row/column/grid` |
| 多模态 UI 理解（参考图 / 截图） | `apps/web/src/lib/mock-design.ts` `createDesignEvents("image")` + `LAYOUT_INFERRED` / `COMPONENTS_DETECTED` 事件 | 切到 I2D → 点"运行设计稿生成演示" | 多模态不是只看像素，而是融合视觉预览与 Figma 结构：参考图走视觉骨架识别，Figma 包走节点树，产出同一份 UISpec |
| 组件识别 / Design Token 绑定 | `packages/component-matcher` + `TOKENS_BOUND` 事件 | 中栏看"组件识别证据" + 绑定 token 数量 | 召回（SDS Registry）→ 决策（证据 + 置信度）→ 落库（accepted / review / unmapped 三态）；token 绑定率是评测维度之一 |

## 3. 职责 3：D2C 出码（设计稿 → 生产代码）

| JD 条目 | 项目模块 | 演示动作 | 讲稿要点 |
|---|---|---|---|
| 真实代码生成（非 prompt 字符串拼接） | `packages/codegen/src/index.ts` `generateReactCode({mode:"draft"\|"final"})` | 右栏"代码交付"切换"页面预览 / 代码 Diff"页签 | 草稿与终稿走同一套 DFS 元素发射 + StyleRef 落点；差异落在 `tokens.css` 与 StyleRef 元数据，不是"看上去一样" |
| 复用企业组件库 / SDS | `packages/component-matcher` + `import { ProductCard } from "@/components/ProductCard"` | 中栏"组件匹配证据"显示 import path | 不是让模型盲扫仓库，而是用 SDS Registry 召回候选 + 置信度 + 证据；未命中走 `unmapped` 状态 |
| Design Token 合规（颜色 / 间距 / 字号） | `packages/codegen` `tokensLayer` + 草稿 emit `var(--spacing-lg)` / 字面量 | 右栏看评分维度 `tokenCompliance` 从 37 涨到 100 | 间距是 16 倍数且声明匹配 → `var()`；否则字面量化 + 漂移；终稿统一 token 化并补全未声明 typography |
| 代码 Diff 可审查 | `apps/web/src/components/DiffView.tsx` + `apps/web/src/lib/diff.ts` LCS 行 diff | 右栏切到"代码 Diff"页签 | 真实 LCS 算法逐行 diff tokens.css，配合 repair patches；不是文本字面量 `===` 比较 |

## 4. 职责 4：对话式画布编辑

| JD 条目 | 项目模块 | 演示动作 | 讲稿要点 |
|---|---|---|---|
| 自然语言 → 结构化编辑操作 | `packages/canvas-ops/src/index.ts` `parseIntent` + `applyEditOps` | I2D 模式 → 自动播放 → ChatPanel 输入"把第二张卡片换成 lime"→ 发送 | 中文规则模式：目标（第N/最后/卡片/标题）× 动词（换成/改成/设为）× 值（颜色中文映射 cobalt/coral/lime/charcoal）；解析不了 → null → 诚实兜底 |
| 类型化编辑操作 | `EditOp` 联合类型（set-prop / set-style / set-text / set-layout） + `applyEditOps` 纯函数 | 切换 Provider 到 LLM（设置面板）后看 trace toolCalls | 扁平可辨识联合 + selector（nodeId / semanticRole / component / ordinal）+ 深克隆写入；下游不直接吃自然语言 |
| LLM 与本地工具双轨 | `apps/web/src/lib/provider.ts` + `apps/server/src/llm.ts` + `apps/web/src/components/SettingsPopover.tsx` | 设置面板切到 LLM，填 key，发送指令 | 默认规则解析（演示零风险）；切到 LLM 走 `POST /api/canvas/interpret`，key 仅存 localStorage 走 X-LLM-Key 请求头；LLM 不可达自动降级规则解析 + toolCalls `fallback:true` + ChatPanel 提示 |
| 实时编辑 + 导出 | `designSpec` useState + `CANVAS_EDITED` 事件实时追加 | 聊天面板发送后画布实时刷新 | spec 用 useState（SPEC_GENERATED 时一次性播种），编辑事件实时 push 进 trace feed，不打断分步演示 |

## 5. 职责 5：规范校验 / 质量评测

| JD 条目 | 项目模块 | 演示动作 | 讲稿要点 |
|---|---|---|---|
| 多维独立评测（不靠 Build Agent 自评） | `packages/evaluator/src/index.ts` 六维指标：geometry / componentReuse / tokenCompliance / visualFidelity / semanticStructure / codeQuality | 右栏六维评分条 + ScoreRing | 六维加权 `round(Σw·m/2)/10`；Build 与 Eval 上下文隔离，Eval 只读 artifact 不知道生成历史 |
| 真实 violation 归因 | `packages/evaluator` scan artifact 的 styleRefs（DFS 序确定性 fold）→ violation id | 右栏"3 项问题已修复"列 | violation 选取 = 草稿产物计算得到，不是字面量清单；测试钉死 3 个 id 防回归 |
| 评测阈值（不止自评） | Eval 通过门槛 = `overall ≥ 90` & `P0 = 0` | 看 ScoreRing + "已达到评审标准"文案 | 单轮评分 90 以下必须触发 REPAIRING；评分仍 < 90 走 NEEDS_REVIEW |

## 6. 职责 6：评测反馈闭环

| JD 条目 | 项目模块 | 演示动作 | 讲稿要点 |
|---|---|---|---|
| 自动修复（Eval 驱动 Build 重跑） | `packages/orchestrator` 状态机 `EVALUATED → REPAIRING → BUILT → EVALUATED → COMPLETED` | 中栏看 12 个事件流转 | 不是"Build Agent 自己宣布通过"，而是 Eval 不达标就 planRepairs → applyRepairOps → codegen final → 重新 Eval |
| 类型化修复操作 | `packages/codegen/src/index.ts` `planRepairs(artifact, spec, declared)` → `RepairOp`（tokenize / restore-value / define-token / snap-to-declared） | 切换"代码 Diff"看 tokens.css 增量 + repairPatches | 修复操作类型化四类，避免字符串拼接；最终落点是 StyleRef 元数据 + tokensLayer |
| 复评证据（resolvedViolationIds） | `packages/evaluator` `compareEvaluations` + `evaluationReportSchema.resolvedViolationIds` | 右栏"3 项问题已修复" | 第二轮 evaluation 报告带 `resolvedViolationIds`；下载报告里能逐项追溯 |
| 双 fixture 泛化 | `examples/figma-bundles/{product-grid, form-page}/` | 顶栏切"表单页"→ 重新演示 → 评分变 52.1→91.9 | form-page 故意含未映射组件（Checkbox）+ 漂移 gap；测试断言与 product-grid 分数完全不同 → 证明非硬编码 |

## 7. 要求 1～8：工程能力

| JD 要求 | 项目模块 | 演示动作 | 讲稿要点 |
|---|---|---|---|
| LLM / Agent 框架 | `apps/server/src/llm.ts` Anthropic 兼容 + `apply_canvas_edits` tool + AbortController 8s 超时；web 端 `provider.ts` 双轨派发 | 设置面板切到 LLM 后看 trace toolCalls | 演示零风险默认走规则解析；接 LLM 仅是 provider id 切换 |
| Figma 工具 | `packages/figma-importer` zip 安全 + `packages/ui-compiler` Auto Layout 编译 | 左栏"设计输入" 节点树 | 不依赖 MCP：结构化 zip 比 plugin 调用更可控 + 可测试 |
| 前端工程（React / TS） | `apps/web` React 19 + lucide-react；`pnpm` monorepo；`noUncheckedIndexedAccess` 严格模式 | 看 `pnpm test` 全绿 | 测试 + 类型 + bundle 拆分一致，不靠运行时类型断言 |
| UI 设计理解 | SpecRenderer 按 semanticRole / figmaComponent 派发；form-page 与 product-grid 共用渲染器 | 切换 fixture 看同一渲染器吃不同结构 | 不写死节点 ID；新增 fixture 不用改渲染器 |
| 评测指标设计 | `packages/evaluator` 六维公式文档化 + 校准测试钉 72 / 94 / 52.1 / 91.9 | 看评分从 72→94、52.1→91.9 | 校准常数（80px 漂移预算、/32 二次项、2/10/4 罚项）由测试钉死，回归时精确报错 |
| 真实场景落地 | `product-grid.zip` + `form-page` 双 fixture + 真实上传链路 + 浏览器内真实执行（与 server SSE 等价） | 上传真实 zip / 切 fixture / 自动播放 | 浏览器内本地真实执行 + 上传到 server 走同一确定性管线，`scripts/consistency.test.ts` 守护两路逐字段一致 |
| 文档 / 沟通 | `README.md` + `docs/demo-script.md` + `docs/jd-mapping.md` + 各包内中文注释 | 看仓库文档 + demo 脚本 | 注释用中文，commit message 用中文（commit 习惯）；讲稿与代码一一对应 |
| 工程能力（CI / 测试 / 部署） | `pnpm test` / `pnpm typecheck` / `playwright.config.ts` / `pnpm e2e` | `pnpm test` 116 个用例 + `pnpm e2e` 浏览器 e2e | 没有 mock 偷懒：figma-importer 拒绝伪造输入、evaluator violation 钉 id、consistency 钉 web ≡ server 逐字段 |

## 附录：每个 commit 回挂的 JD 条目

| Commit | 新增 / 改动 | 对应 JD 条目 |
|---|---|---|
| Commit 1（真实管线后端） | codegen / evaluator / orchestrator | 职责 3 / 5 / 6 |
| Commit 2（web 本地真实执行） | apps/web/src/lib/local-run.ts | 要求 6（真实场景落地） |
| Commit 3（toolCalls + Diff） | TraceEventCard + DiffView | 职责 1 / 3 |
| Commit 4（form-page fixture + SpecRenderer） | form-page 资产 + SpecRenderer | 职责 3 / 6 |
| Commit 5（canvas-ops + 交互式 ChatPanel） | canvas-ops + ChatPanel | 职责 4 |
| Commit 6（LLM Provider） | llm.ts + provider.ts + SettingsPopover | 职责 4 / 要求 1 |
| Commit 7（docs） | jd-mapping + demo-script | 要求 7 |

## 现场可验证（截图留证）

1. 改 `examples/figma-bundles/product-grid/variables.json` 删除 `color/accent` → 重新演示 → tokenCompliance 从 100 跌至 60 左右
2. 改 `design.json` 把 grid `gap` 从 20 改为 12 → 重新演示 → geometry 漂移可见
3. 切到 form-page → 重新演示 → 看到表单未映射 Checkbox 触发 `unmapped` 状态 + 草稿分数 52.1
4. 设置面板切到 LLM 但 key 留空 → 发送指令 → 降级规则解析 + ChatPanel 提示 LLM 不可达
