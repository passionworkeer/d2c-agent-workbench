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
| **真视觉模型**（image → UISpec） | `apps/server/src/vision.ts` `interpretReferenceImage`（Anthropic vision image content block + `emit_ui_spec` tool calling）+ `POST /api/vision/interpret` | I2D 设置 provider=llm + key → 上传参考图 PNG → 看"多模态 UI 理解完成（真实视觉模型）"与 toolCalls `vision.*` | 视觉输出不进自由文本而是 tool 参数，服务端 zod 校验后才进链路；失败自动降级演示链路并如实提示（画布下方 vision-note） |
| 组件识别 / Design Token 绑定 | `packages/component-matcher` + `TOKENS_BOUND` 事件 | 中栏看"组件识别证据" + 绑定 token 数量 | 召回（SDS Registry）→ 决策（证据 + 置信度）→ 落库（accepted / review / unmapped 三态）；token 绑定率是评测维度之一 |

## 3. 职责 3：D2C 出码（设计稿 → 生产代码）

| JD 条目 | 项目模块 | 演示动作 | 讲稿要点 |
|---|---|---|---|
| 真实代码生成（非 prompt 字符串拼接） | `packages/codegen/src/index.ts` `generateReactCode({mode:"draft"\|"final"})` | 右栏"代码交付"切换"页面预览 / 代码 Diff"页签 | 草稿与终稿走同一套 DFS 元素发射 + StyleRef 落点；差异落在 `tokens.css` 与 StyleRef 元数据，不是"看上去一样" |
| 复用企业组件库 / SDS | `packages/component-matcher` + `import { ProductCard } from "@/components/ProductCard"` | 中栏"组件匹配证据"显示 import path | 不是让模型盲扫仓库，而是用 SDS Registry 召回候选 + 置信度 + 证据；未命中走 `unmapped` 状态 |
| **企业组件资产库接入** | `packages/asset-indexer` `scanRepo`（React + Storybook + Code Connect 扫描）+ `mapSdsComponents(spec, registry?)` 注入 + `examples/sample-design-system/` 6 个真组件样本 | `GET /api/health?scan=dynamic` 看动态 registry 大小；看 asset-indexer 测试「扫描 registry ≡ 内置静态表」 | 换公司组件库不改 workbench 代码：扫描约定（export 名 / figmaComponentNames / Storybook title+argTypes）正则可解析、人可读；扫描结果与静态表在 product-grid 上产出一致映射（测试钉死防回归） |
| Design Token 合规（颜色 / 间距 / 字号） | `packages/codegen` `tokensLayer` + 草稿 emit `var(--spacing-lg)` / 字面量 | 右栏看评分维度 `tokenCompliance` 从 37 涨到 100 | 间距是 16 倍数且声明匹配 → `var()`；否则字面量化 + 漂移；终稿统一 token 化并补全未声明 typography |
| 代码 Diff 可审查 | `apps/web/src/components/DiffView.tsx` + `apps/web/src/lib/diff.ts` LCS 行 diff | 右栏切到"代码 Diff"页签 | 真实 LCS 算法逐行 diff tokens.css，配合 repair patches；不是文本字面量 `===` 比较 |

## 4. 职责 4：对话式画布编辑

| JD 条目 | 项目模块 | 演示动作 | 讲稿要点 |
|---|---|---|---|
| 自然语言 → 结构化编辑操作 | `packages/canvas-ops/src/index.ts` `parseIntent` + `applyEditOps` | I2D 模式 → 自动播放 → ChatPanel 输入"把第二张卡片换成 lime"→ 发送 | 中文规则模式：目标（第N/最后/卡片/标题）× 动词（换成/改成/设为）× 值（颜色中文映射 cobalt/coral/lime/charcoal）；解析不了 → null → 诚实兜底 |
| 类型化编辑操作 | `EditOp` 联合类型（set-prop / set-style / set-text / set-layout） + `applyEditOps` 纯函数 | 切换 Provider 到 LLM（设置面板）后看 trace toolCalls | 扁平可辨识联合 + selector（nodeId / semanticRole / component / ordinal）+ 深克隆写入；下游不直接吃自然语言 |
| LLM 与本地工具双轨 | `apps/web/src/lib/provider.ts` + `apps/server/src/llm.ts` + `apps/web/src/components/SettingsPopover.tsx` | 设置面板切到 LLM，填 key，发送指令 | 默认规则解析（演示零风险）；切到 LLM 走 `POST /api/canvas/interpret`，key 仅存 localStorage 走 X-LLM-Key 请求头；LLM 不可达自动降级规则解析 + toolCalls `fallback:true` + ChatPanel 提示 |
| 实时编辑 + 导出 | `designSpec` useState + `CANVAS_EDITED` 事件实时追加 | 聊天面板发送后画布实时刷新 | spec 用 useState（SPEC_GENERATED 时一次性播种），编辑事件实时 push 进 trace feed，不打断分步演示 |
| **设计稿回写 Figma** | `packages/figma-patcher`（EditOp → setNodeChanges，token 解字面量 / GRID 降级记录）+ `apps/server/src/figma.ts`（PUT `/v1/files/:key/nodes`，403 → 评论降级）+ `apps/web/src/components/FigmaPatchPanel.tsx` | I2D 编辑两轮 → 回写面板填 PAT + FileKey → 预览变更（dryRun）→ 应用到 Figma | 回写范围 = 对话编辑累计的 EditOp；selector 语义复用 canvas-ops 保证「画布怎么改、Figma 就改哪」；PAT 走 X-Figma-Token 头经代理，与 LLM key 同安全模式 |

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
| 工程能力（CI / 测试 / 部署） | `.github/workflows/ci.yml`（push/PR 自动 typecheck + 429 单测 + 构建，e2e 刻意留本地——Playwright 浏览器与真实 install 不进 CI 是显式取舍）+ `pnpm test` / `pnpm typecheck` / `playwright.config.ts` / `pnpm e2e` | 看 GitHub Actions 绿标 + 本地 `pnpm test` 全仓 429 个用例 + `pnpm e2e` 8 条浏览器 e2e（含真实生产闭环 3 条） | 没有 mock 偷懒：figma-importer 拒绝伪造输入、evaluator violation 钉 id、consistency 钉 web ≡ server 逐字段、asset-indexer 钉扫描 ≡ 静态表、key/PAT 不落盘由路由测试钉死 |
| 可复用 Skills / Tools | `skills/d2c-agent-workbench/`（SKILL.md + references + scan-design-assets.mjs）+ `scripts/build-skill-zip.mjs` + `scripts/skill-assets.test.ts` | 顶栏点「导出 D2C Skill」→ 下载 ZIP 解压看结构 | Web 把链路可视化，Skill 把方法迁移到其它 Agent：输入检查、有无设计资产的降级分支、执行顺序、证据与停止条件都在包里；ZIP 与 canonical 逐字节一致（测试钉死），不依赖后端 |

## 8. 压轴：活动页生产闭环（PRODUCTION）

> D2C/I2D 演示的是「设计意图 → 可评测代码」；PRODUCTION 把同一套评测哲学落进**真实仓库**——这是 JD「D2C 出码落地研发流程」的最直接回答。

| JD 条目 | 项目模块 | 演示动作 | 讲稿要点 |
|---|---|---|---|
| 设计意图编译为可交付代码 | `packages/production-runtime`（隔离工作区 `seedWorkspaceFrom` / `runAllowedCommand` 白名单 + 最小 env / Playwright 渲染 / 回滚快照）+ `packages/orchestrator` 生产状态机（INPUT_VALIDATED → … → EVALUATED → ATTRIBUTED → REPAIR_* → COMPLETED） | 切「活动页生产」→ 载入黄金样例 → 运行生产闭环（约 20–30s，启动即后台预热依赖） | 目标仓库复制进隔离工作区，真实 `pnpm install` / `tsc` / `vite build`；Profile 命令服务端注册、客户端不可注入；每步产出带 Artifact ID 的落盘证据 |
| 证据驱动评分（缺证据不默认满分） | 生产 evaluator：5 项视觉指标各带 `*Available` 布尔，缺证据记 `null` 按可用项归一权重；闭环内 MiniMax 双图语义评审（四维子分 + issues），无 key/失败回退服务端注册基准并如实标 `provider=registered-fallback` | 跑完看「评测分构成」面板（缺证据项标红「缺参考截图」）+ 展开「语义评审证据」四维子分 | 真模型在环但分数永远可复现：有 key 走 MiniMax 实时，没 key 走注册基准，provider 字段从不撒谎；任一视口横向溢出是 P1 硬门槛，build 失败是 P0，分数刷不掉 |
| 评测反哺定位修复 | 违规 → Region → Node → Source 归因；修复 ≤5 文件、CSS 声明级 / ts-morph AST 级补丁；每轮先写回滚快照，修复后 build 失败自动 `restoreRollback` | 点违规 → 桌面截图红框叠加定位 → 看「仅修改 2 个文件」 | 修复不是整体重生成，是定位到 `CampaignPage.module.css` `.hero` 的声明级补丁；黄金样例内置一处可修复 Hero 间距（48px vs 参考稿 x=0），首轮 P1 → 修复 → 复评 COMPLETED |
| 真实样例诚实达标 | `examples/activity-pages/` 三张真实手机截图样例（快手商城 / 夏日游戏节 / 养萌宠红包）+ 按样例声明的验收门槛（70/62） | 切「快手商城」→ 跑出实测 75–80 分 COMPLETED（门槛 70 按样例在服务端声明），与黄金样例 93+ 同屏对比 | 照片重采样 + 语义重建导航有像素天花板——分数如实落在 75–80（明显低于黄金样例）、门槛按样例声明不放松也不虚高；真实照片页不到 90 分依然过验收，本身就是评测诚实的活证据 |
| 可追溯交付 | Run 报告下载（事件流 + 分数构成 + 文本证据 + 违规 + 双视口逐节点几何）/ 历史 Run 只读回看（服务端重启后从磁盘重载）/ 启动清理孤儿工作区 + runs 封顶 50 条 | 点「下载 Run 报告」；顶部「历史 Run」点任一条只读回看 | 「重启后数据还在吗」当场可演：证据链独立于工作区持久化，回看态同样可下载报告；磁盘卫生（孤儿清理 / 封顶淘汰）是生产系统素养 |
| 设计干预直达代码 | Puck 原型编辑 → 类型化 `SpecEditOp` 回写 ActivitySpec → 按编辑重跑强制重新生成 | 闭环完成后改标题 → 保存编辑 → 文本证据面板展开「基线列 + ✓ 编辑已应用」→ 按编辑重跑 | 编辑不直接改代码：改的是单一事实源 ActivitySpec，渲染 DOM 列跟着变——"设计意图落到了代码，全程可追溯" |
| 反向链路：代码 → Figma | `buildFigmaImportBundle` v2 自包含导入包（素材 base64 随包 / imageCrop 归一化 / 缺证据节点进 degradations）+ `apps/figma-importer-plugin` 离线插件（零运行时依赖、手写结构校验） | PRODUCTION → 「下载 Figma 导入包」；插件源码在 `apps/figma-importer-plugin` | D2C 不止 figma→code：生产页可回灌 Figma 继续编辑；插件 `networkAccess` 为空——不联网、不读任何令牌，安全姿态与主链路一致 |
| 闭环外 VLM 复核（工程取舍） | `POST /api/production/runs/:id/semantic-review`（key 走 `X-LLM-Key` 头单次生命周期）| 面板「运行 VLM 语义复核」→ VLM 实测与闭环基准并列展示 | 复核结果不计入 finalScore、不写 run.json——闭环评分保持无 key 可复现，VLM 是按需复核证据；「客观指标作门槛、智能评审作复核」这个拆分本身是可部署工程的取舍话题 |

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
| Commit 9（真视觉模型） | vision.ts + /api/vision/interpret + VisionOverride | 职责 2 / 要求 1 |
| Commit 10（企业组件资产库） | asset-indexer + sample-design-system + matcher 注入 | 职责 3 / 要求 2 |
| Commit 11（Figma 回写 Patch） | figma-patcher + /api/figma/patch + FigmaPatchPanel | 职责 4 / 要求 2 |
| Commit 12（docs 收尾） | README / jd-mapping / demo-script 更新 | 要求 7 |
| 生产闭环 13 任务（master c2e37d5 等） | orchestrator 生产状态机 + production-runtime + 证据驱动评测修复闭环 | 职责 3 / 5 / 6 |
| 对抗性审查修复 | SSE 成功误报 / 双上传竞态 / zip bomb 时序 + P2 清单 | 要求 8 |
| 基线列 + Run 报告 + 真实样例打通 | 工作台证据面板 + commerce-feed 等三样例（图集共享源 / NEEDS_REVIEW 展示分） | 职责 5 / 6 |
| 预热 + 孤儿清理 + 历史 Run 回看 | warm.ts + 启动清理 + `GET /runs` 清单 + install `--prefer-offline` | 要求 6 / 8 |
| 闭环外 VLM 复核 | semantic-review.ts + `/runs/:id/semantic-review` 路由 | 职责 5 |
| 真实样例分支合并（6351887） | 手工高保真三样例 + 验收门槛按样例参数化 + Figma 离线导入插件 + 闭环内 MiniMax 语义评审（registered-fallback） | 职责 2 / 5 / 6 + 要求 2 / 8 |
| 可导出 D2C Skill（f31d1ea / 736bb68） | skills/d2c-agent-workbench + build-skill-zip.mjs + e2e 下载解压验证 | 要求 1 / 8（可复用 Skills / Tools） |

## 现场可验证（截图留证）

1. 改 `examples/figma-bundles/product-grid/variables.json` 删除 `color/accent` → 重新演示 → tokenCompliance 从 100 跌至 60 左右
2. 改 `design.json` 把 grid `gap` 从 20 改为 12 → 重新演示 → geometry 漂移可见
3. 切到 form-page → 重新演示 → 看到表单未映射 Checkbox 触发 `unmapped` 状态 + 草稿分数 52.1
4. 设置面板切到 LLM 但 key 留空 → 发送指令 → 降级规则解析 + ChatPanel 提示 LLM 不可达
5. I2D 上传参考图（provider=llm + key）→ vision-note 显示真实视觉模型；拔掉网络再传 → vision-note 显示降级原因
6. I2D 编辑两轮 → 回写面板预览（dryRun 零写入）→ 应用 → trace 出现 SPEC_EXPORTED（target=figma）；用只读 PAT 重试 → transport=comment 评论降级
7. PRODUCTION 跑「快手商城」真实移动样例 → COMPLETED + 实测 75–80 分，与黄金样例 93+ 同屏对比（照片重采样天花板如实写进分数，不调宽容度刷高）；语义评审证据来源标注 MiniMax 实时 / 黄金基准回退——评测不撒谎
8. PRODUCTION 闭环完成 → 点「下载 Run 报告」→ JSON 里逐事件 artifactId 齐全、不含任何 key；重启服务端刷新页面 → 「历史 Run」回看同一 run，证据链完整
9. 黄金样例跑完 → Puck 改标题「全场 6 折」→ 保存编辑 → 文本证据面板展开基线列 + 「✓ 编辑已应用」→ 按编辑重跑 → 渲染 DOM 列跟着变
10. 顶栏「导出 D2C Skill」→ 下载 ZIP 解压 → SKILL.md / references/ / scripts/scan-design-assets.mjs 齐全，与仓库 `skills/d2c-agent-workbench/` 逐字节一致
