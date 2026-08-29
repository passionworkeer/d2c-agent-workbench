# 真实移动活动页黄金样例、Figma 导入与 MiniMax 评审设计

日期：2026-08-29
状态：已确认，待实施

## 1. 背景与目标

现有活动页生产模式已经具备 ActivitySpec、代码生成、隔离构建、Playwright 渲染、像素 Diff、错误归因、局部修复、Puck 编辑和 Figma 导出能力，但当前两个黄金样例的视觉复杂度较低，真实 VLM 语义评分与 Figma 插件实导也尚未闭环。

本次以用户提供的三张真实手机活动页截图为输入，人工完成结构校准、素材分层、企业组件和生产代码，使演示重点从“能跑通”升级为“面对真实复杂页面也能稳定生成、评测、编辑和回到 Figma”。

目标对应岗位 JD 的核心能力：

- 截图 / Figma 多模态 UI 理解；
- ActivitySpec 中间协议与稳定 Node ID；
- 企业组件、Design Token 和代码仓库上下文复用；
- React / TypeScript 生产代码生成；
- 独立 Eval Agent、真实构建渲染、像素 Diff 与语义评审；
- Region → Node → Source 归因和局部修复；
- Puck 编辑回写与 Figma 可编辑节点导入。

本次不为数量制造低质量页面。黄金集由现有 2 个基础样例扩充到 5 个，其中 3 个为本次真实高保真样例。原设计中的 12 页回归集仍作为后续规模化目标。

## 2. 输入与固定验收画布

原始参考图：

| 样例 | 文件 | 原始尺寸 | 390px 基准高度 |
|---|---|---:|---:|
| 商城信息流 | `cdbc11a350f9a2e20f00150fdbe0e5a8.jpg` | 1260×2800 | 867px |
| 夏日游戏任务 | `17817eb52871da70f7d3ea06fadd7367.jpg` | 1260×2660 | 823px |
| 养宠红包 | `eace84b3458bcc82e7bcc2260b54310a.jpg` | 1260×2645 | 819px |

三个页面均为移动端优先页面：

- 390px 宽度下边到边还原；
- Playwright 使用 DPR=1 并截取完整长页；
- 桌面浏览器只展示居中的约 430px 手机画布，两侧为中性深色背景；
- 高保真验收只以 390px 手机画布为准，不声称有桌面端设计稿；
- 任一手机视口横向溢出仍为 P1 硬门槛。

## 3. 三个样例

### 3.1 `commerce-feed`

对应商城信息流页面，路由 `/campaign/commerce-feed`。

结构：

- 手机状态栏与频道顶部导航；
- 搜索框和快捷功能入口；
- 818 活动券 Banner；
- 双列商品卡片流；
- 品牌、价格、销量和榜单标签；
- 底部主导航。

本地交互：频道切换、搜索态、商品点击反馈。商城、支付和真实商品服务不在范围内。

### 3.2 `summer-game-festival`

对应游戏任务活动，路由 `/campaign/summer-game-festival`。

结构：

- 游戏主视觉 Hero；
- 星钻账户、规则和背包入口；
- 联动任务卡和专属福利；
- 星钻兑换卡；
- 每日任务列表；
- 底部活动 Tab。

本地交互：任务领取、兑换状态和 Tab 切换。真实账号、直播间和游戏服务不在范围内。

### 3.3 `pet-red-packet`

对应养宠红包活动，路由 `/campaign/pet-red-packet`。

结构：

- App 顶部导航；
- 活动标题和等级进度；
- 舞台、宠物角色与装饰层；
- 每日签到、衣橱和冒险入口；
- 红包盲盒和能量操作；
- 底部任务区与主导航。

本地交互：喂食、签到、领奖和任务状态。红包、钱包与真实激励服务不在范围内。

## 4. 素材与高保真策略

采用“参考素材 + 结构化 DOM”的混合重建：

1. 原图完整保留为只读视觉参考和像素 Diff 基准；
2. 复杂角色、商品、舞台、灯光、奖励图标和专用活动 Logo 作为图片素材层；
3. 普通文字、价格、标签、卡片、按钮、任务和导航全部使用真实 DOM；
4. 主要结构使用 Flex/Grid，absolute 只用于装饰性图层和浮动入口；
5. 图片素材通过裁切容器、`object-position` 或背景定位使用，页面本身不得直接铺整张截图；
6. 专用图片 Logo 同时提供语义标题，保证无障碍与文本证据不丢失。

每个样例目录包含：

```text
examples/activity-pages/<sample>/
  reference.jpg
  prd.md
  activity-spec.json
  target-profile.json
  figma-import.json
  assets/
    manifest.json
```

`reference.jpg` 与用户提供的参考图保持字节级原样复制，并同时作为视觉素材图集。`manifest.json` 记录每个视觉素材在图集中的归一化裁切区域、用途和对应 Node ID，避免生成不可追溯的匿名图片。像素比较前由服务端在内存中按实际渲染宽度等比归一化参考图，不生成或提交重复的缩放副本。

## 5. 企业级前端架构

目标仓库新增轻量活动页设计系统：

```text
examples/activity-target/src/
  components/activity/
    MobileActivityShell.tsx
    PhoneStatusBar.tsx
    KwaiTopNavigation.tsx
    BottomTabBar.tsx
    SearchBar.tsx
    ProductCard.tsx
    TaskCard.tsx
    RewardTile.tsx
    ProgressCard.tsx
    FloatingAction.tsx
    PrimaryActionButton.tsx
    ArtworkSlice.tsx
  pages/campaign/
    CommerceFeedPage.tsx
    CommerceFeedPage.data.ts
    CommerceFeedPage.module.css
    SummerGameFestivalPage.tsx
    SummerGameFestivalPage.data.ts
    SummerGameFestivalPage.module.css
    PetRedPacketPage.tsx
    PetRedPacketPage.data.ts
    PetRedPacketPage.module.css
```

职责划分：

- Page 负责页面组合和本地交互状态；
- `*.data.ts` 负责商品、任务和奖励数据；
- CSS Module 负责页面专属视觉；
- 公共组件负责语义、可访问性、交互状态和稳定 Node ID；
- Design Token 使用 CSS Custom Properties，页面不得散落重复品牌色和间距常量。

生成代码通过服务端白名单映射复用上述组件。组件映射只允许命中 `apps/server/src/profiles.ts` 注册的组件与 importPath，客户端不能扩大允许范围。

## 6. ActivitySpec 与代码生成

每个 ActivitySpec 覆盖完整主要层级，而不是只提供根节点：

- 页面、主要 Section、卡片、任务、奖励、交互按钮和语义文字均有稳定 ID；
- 装饰素材有明确的 `assetId` 与 Evidence；
- `sourceBox` 使用 390px 基准坐标；
- `responsive` 明确为手机保持、堆叠或隐藏规则；
- 低置信度视觉判断写入 `unresolved`，人工校准后才进入黄金基准；
- Spec、React `data-d2c-node-id`、SourceMap、Diff Region 和 Figma `pluginData.d2cNodeId` 必须一致。

代码生成器继续负责页面入口、组件 import、资产 URL、SourceMap 和 CSS 产物。页面特有的复杂视觉通过受信任企业组件组合完成，不在生成器中加入按 sampleId 分支的硬编码模板。

## 7. Figma 实际导入

新增 `apps/figma-importer-plugin`：

```text
apps/figma-importer-plugin/
  manifest.json
  src/code.ts
  src/ui.html
  package.json
  tsconfig.json
```

插件从用户本地选择工作台导出的单个 JSON bundle，不联网、不读取 PAT。bundle 自包含导入所需的 base64 图片资产，因此现场不需要再次选择图片文件。插件负责：

- 创建 390px 手机 Frame；
- 递归创建 Frame、Text、Rectangle 和图片填充；
- 恢复 Auto Layout、间距、圆角、颜色、阴影和节点层级；
- 根据素材 manifest 恢复图片裁切；
- 写入 `pluginData.d2cNodeId`；
- 字体不可用时回退中文系统字体并记录降级；
- 素材不可用时创建命名占位节点，不静默删除；
- 导入结束展示节点数、素材数、字体回退和其它降级。

`FigmaImportBundle` 扩展以下字段：

- `version`；
- `viewport`；
- `assets`，包含稳定 ID、MIME 与 base64 数据；同一图集只嵌入一次；
- 图片 fill 的 crop 信息；
- `degradations`；
- 每个节点的 `pluginData`。

三个样例提交预生成 `figma-import.json`。工作台编辑 ActivitySpec 后仍能下载最新 bundle。

## 8. MiniMax 多模态语义评审

### 8.1 配置

服务端配置优先级：

1. 标准环境变量 `MINIMAX_API_KEY`、`MINIMAX_BASE_URL`、`MINIMAX_MODEL`；
2. 兼容现有根目录 `.env` 中的 `key`、`url`、`model`。

`.env` 保持 gitignore。配置值不得出现在日志、Run JSON、Artifact、SSE、错误响应或浏览器端。

### 8.2 调用

每轮渲染后，服务端将参考图和当前完整截图作为两个 image content block 发送到 MiniMax Anthropic 兼容端点，并强制调用 `emit_semantic_review` 工具。返回结构：

```ts
interface SemanticReviewResult {
  score: number;
  layout: number;
  content: number;
  visualTone: number;
  taskClarity: number;
  summary: string;
  issues: Array<{
    title: string;
    severity: "P1" | "P2" | "P3";
    region?: Rect;
  }>;
  provider: "minimax" | "registered-fallback";
}
```

模型输出经 Zod 严格校验并作为独立 Artifact 保存。Evaluator 只消费服务端产生的 `score`，客户端继续禁止提交 `semanticReviewScore`。

### 8.3 降级

MiniMax 缺配置、超时、鉴权失败、响应无工具调用或 Schema 不合法时：

- 记录不含凭证的失败原因；
- 使用样例注册表的本地黄金语义基准；
- provider 标记为 `registered-fallback`；
- 工作台明确展示回退，不声称模型成功；
- 生产闭环可继续完成，保证面试现场稳定。

## 9. 工作台演示动线

活动页生产模式新增三个带缩略图的真实样例。推荐演示流程：

1. 选择真实参考图；
2. 展示人工校准的 ActivitySpec、素材 Evidence 和组件候选；
3. 运行生产闭环；
4. 展示真实 typecheck、build 和 Playwright 手机渲染；
5. 展示像素 Diff、MiniMax 语义解释和证据来源；
6. 点击差异查看 Region → Node → Source；
7. 用 Puck 修改标题或任务文案；
8. 重跑并展示代码、截图和分数变化；
9. 下载 Figma bundle；
10. 在 Figma Plugin 中导入为可编辑节点。

UI 必须区分：

- `MiniMax 实时评审`；
- `黄金基准回退`；
- `缺失证据`。

## 10. 数据流与安全边界

```text
Reference JPG
  → ActivitySpec / asset manifest
  → server-registered sampleId + component allowlist
  → generated React/CSS/assets in isolated workspace
  → typecheck/build
  → Playwright full-page mobile render
  → pixel diff + MiniMax semantic review
  → attribution + repair
  → Puck edit / Figma import bundle
```

安全要求：

- 客户端不能提交 Profile、命令、仓库路径、组件白名单或评分；
- 原图只在本地仓库和本地模型请求中使用，不上传第三方存储；
- VLM key 只存在服务端内存和出站请求头；
- Preview 子进程继续使用最小环境白名单，不能继承模型 key；
- Figma Plugin 不联网且不接触 PAT；
- 素材路径继续受 `assetSourceRoot` 与 `allowedWriteGlobs` 约束。

## 11. 错误处理

- 参考图或素材缺失：创建 Run 前失败，不进入构建；
- 素材裁切区域非法：Schema 校验失败并指出 assetId；
- 企业组件映射不在服务端允许列表：400 `MAPPING_FORBIDDEN`；
- 生成代码 typecheck/build 失败：P0，修复后失败则按既有规则回滚；
- 手机端横向溢出：P1，不允许高分覆盖；
- MiniMax 失败：显式回退并保留错误摘要；
- Figma 字体或图片缺失：导入继续，但输出可见降级报告；
- Node ID 不一致：测试失败，禁止提交黄金样例。

## 12. 测试与验收

### 12.1 单元测试

- 三个 ActivitySpec 通过 Schema 且节点 ID 唯一；
- 素材 manifest 的裁切范围合法；
- 注册 sampleId、组件映射和资产根受服务端白名单约束；
- MiniMax 配置读取不泄露 key；
- 双图工具调用请求结构正确；
- 模型成功、超时、鉴权失败、无工具调用和坏 Schema 均有覆盖；
- Figma bundle 包含稳定 Node ID、图片 crop 和降级信息；
- Figma Plugin 节点转换逻辑可在 mock Figma API 下测试；
- 公共活动组件具备可访问名称和键盘行为。

### 12.2 集成与 E2E

- 三个样例均完成真实安装、typecheck、build、preview 和 full-page render；
- 390px 无横向溢出；
- 关键结构节点几何误差不超过 3%；
- 页面完整高度与参考图比例一致；
- 普通文字全部进入 DOM 文本一致性证据；
- MiniMax 可用时 provider 为 `minimax`；不可用时 provider 为 `registered-fallback` 且 UI 明示；
- Puck 编辑后重新生成的代码与截图包含新文案；
- 三个预生成 Figma bundle 通过 Schema 和插件转换测试；
- 现有全量测试、类型检查和构建保持通过。

### 12.3 视觉验收

- 商品、人物、舞台和复杂装饰使用原始素材，不能用近似色块代替；
- 导航、卡片、按钮、任务、价格和普通文案为真实 DOM；
- 页面在 390px 下主色、层级、密度和关键区域位置与参考图一致；
- 像素分和语义分均展示来源；
- 高保真目标聚焦手机端，不对桌面端像素还原作承诺。

## 13. 交付清单

- 3 个新真实黄金样例目录；
- 3 套企业级 React/TypeScript 页面；
- 活动页公共组件与 Design Token；
- 3 份完整 ActivitySpec；
- 3 份预生成 Figma 导入包；
- 可运行的本地 Figma Import Plugin；
- MiniMax 双图语义评审与诚实降级；
- 工作台样例选择、证据标签和演示动线；
- 单元、集成、视觉和 E2E 测试；
- README、演示脚本和最终验收清单更新。

## 14. 非目标与后续项

- 不接真实商城、支付、钱包、直播、游戏或任务后台；
- 不复制原 App 的业务逻辑；
- 不声称拥有参考图中的品牌或素材版权，产物仅用于本地岗位演示；
- 不在本次凑齐 12 个黄金页面；
- 不实现桌面端高保真设计；
- 不让 VLM 直接写代码或绕过 ActivitySpec、组件白名单和 Build/Eval 门槛。
