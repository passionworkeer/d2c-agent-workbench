# Figma 高保真截图还原设计

## 背景与结论

现有 Figma 导入包已经修复了嵌套坐标叠加、缺失的颜色兜底和整页图集裁切，但它只证明了 JSON 可以被解析，不能证明导入到真实 Figma 后的视觉结果。三份真实样例的预生成包也全部标记为缺少 Playwright 渲染证据。

当前链路还会丢弃导出包中存在的填充透明度；协议中已有、但 Figma 适配器没有映射的圆角、阴影、文字对齐、行高和字距会造成明显视觉差异。将 `flex` / `grid` 直接翻译为 Auto Layout 也会让 Figma 在截图还原场景中重排子节点。

本设计采用“混合高保真”：可可靠分解的业务 UI 以原生 Figma 节点呈现；复杂且不可可靠反推的视觉区域以精确裁切的栅格区域呈现。两者的范围、可编辑性和视觉验收结果必须可审计，不能把整页截图当作成功还原。

## 目标

1. 三张真实移动活动页导入 Figma 后，在 390×867 根 Frame 内得到可导出的高保真画面。
2. 文本、按钮、导航、商品卡容器和任务项以原生 Figma 节点出现；商品图、插画和复杂纹理可以是裁切图片。
3. `ActivitySpec → FigmaImportBundle → Figma 插件 → Figma Node` 不丢失样例实际使用的视觉属性。
4. 每张样例都有真实 Figma 导出 PNG、像素比对结果、文本/几何/资产裁切结果和节点可编辑性清单。
5. 任一缺失资产、字体回退、未支持样式或视觉阈值不达标都会在报告中失败或降级，不能静默宣称通过。

## 非目标

- 不从单张截图臆造原始 React 组件、交互逻辑或设计 token 的真实来源。
- 不把整页原图作为默认可见的底图来获得虚假的像素满分。
- 首期不自动连接企业 Figma 文件或远程组件库；已有匹配信息时允许后续映射为组件实例。
- 不承诺将插画内部的位图内容转换为可逐笔编辑的矢量对象。

## 输出模型

导入后的页面由以下层级组成：

```text
活动页 Frame（390×867，clipsContent）
├── Reference（隐藏、锁定，仅供人工对照）
├── Reconstruction
│   ├── 原生 Frame / Text / Rectangle
│   ├── 可复用组件实例（有企业组件映射时）
│   └── Raster region（仅插画、纹理、商品照片等）
└── D2C metadata（稳定 node id、来源证据、布局语义、降级原因）
```

`Reference` 只在人工检查时开启，不参与默认画面和像素评分。默认可见的 `Reconstruction` 必须独立达到验收门槛。每个节点在包内标记为以下一种类别：

| 类别 | 适用范围 | 编辑承诺 |
| --- | --- | --- |
| `native` | 文本、几何容器、按钮、导航、卡片 | 原生属性可编辑 |
| `component` | 已匹配的企业设计系统组件 | 实例与公开属性可编辑 |
| `raster` | 商品照片、插画、粒子/复杂渐变纹理 | 可移动、替换、裁切；内部像素不承诺编辑 |

文本、按钮和导航不能仅因方便而标记为 `raster`。若无法原生还原，它们应当成为阻塞降级，而不是隐性地混入图片。

## Bundle 与插件契约

`FigmaImportBundle` 保持向后兼容地增加以下属性，并在解析器、导出器、插件适配器中完整贯通：

- 节点：`opacity`、`cornerRadius`、`strokes`、`effects`、`clipsContent`、`layoutStrategy`、`renderKind`。
- 文本：`fontFamily`（实测优先，`spec.visual` 回退）、`fontSize`、`fontWeight`、`lineHeight`、`letterSpacing`、水平对齐。
- 填充：SOLID 的 `opacity` 必须写入 Figma Paint；IMAGE 保留 `imageTransform` 和裁切区域。
- 布局：截图还原包默认 `layoutStrategy: "absolute"`。插件只为显式声明为 `auto` 且验证通过的容器启用 Auto Layout；其余 Frame 保持 `NONE`，并将原布局语义保存为 D2C 元数据。

CSS 风格的 `border` 与 `shadow` 需要在导出时解析为结构化 stroke/effect；无法解析的值加入 `unsupported-style` degradation，不能被吞掉。现有 `missing-render-evidence` 保留，但它不再是纯提示：若需要实测字体、颜色或几何而缺失，则该样例不能进入最终“已验证”状态。

## 导入流程

1. 导出器根据 `sourceBox` 建树，使用页面绝对坐标；插件在 appendChild 前换算为父级相对坐标。
2. 插件先创建根 Frame，设置固定尺寸和裁剪；随后以绝对布局创建重建节点，避免 Auto Layout 改写截图坐标。
3. 先应用节点几何和可见性，再应用填充、透明度、圆角、边框、阴影与文本排版，最后 appendChild。
4. 为 `raster` 节点创建 IMAGE fill 并按证据区域/原图尺寸的归一化裁切写入 transform。
5. 字体加载失败时使用明确回退，导入报告列出节点、目标字体、实际字体，并把该样例标为视觉未验证。
6. 有组件映射时，仅在组件的已验证变体与截图几何一致时创建实例；否则创建 `native` 节点并记录未映射原因。

## Figma 内验证

插件增加“导出并验证”操作：对导入根 Frame 调用 Figma 的 PNG 导出能力，将 PNG 和 `figma-visual-report.json` 交给插件 UI 下载或提交到本地工作台。UI 使用参考图与导出 PNG 在同一尺寸下执行像素比较，并生成 diff 图。

报告至少包含：

```json
{
  "fixtureId": "commerce-feed",
  "frame": { "width": 390, "height": 867 },
  "visual": { "score": 0, "differentPixels": 0, "totalPixels": 0 },
  "geometry": { "p95DeltaPx": 0, "maxDeltaPx": 0 },
  "text": { "expected": 0, "matched": 0 },
  "assets": { "checked": 0, "cropMismatches": [] },
  "editability": { "native": 0, "component": 0, "raster": 0 },
  "degradations": []
}
```

视觉差异由当前已有的图像比较能力计算，固定 Figma 导出比例、背景与字体环境。像素 diff 图、Figma 导出 PNG、报告 JSON 都是三页验收工件，不能只保存口头结论或单元测试结果。

## 验收标准

每张 `commerce-feed`、`summer-game-festival`、`pet-red-packet` 都必须满足：

1. 根 Frame 正好为 390×867，无画布外溢出。
2. 100% 预期文本存在且内容匹配；文本/按钮/导航均不是 `raster`。
3. 所有 manifest 资产的 `imageCrop` 与证据区域归一化结果偏差不大于 0.001。
4. 用到的视觉属性 100% 被映射或显式列为 degradation；没有静默忽略。
5. 原生与组件节点的几何 p95 偏差不超过 1 px，最大偏差不超过 2 px；文本基线差异单独记录。
6. 默认可见 `Reconstruction` 与参考图的视觉分数不低于 95；任何单块明显差异都必须进入 diff cluster 和修复队列。95 以下不能标为高保真。
7. 报告中不存在 `missing-asset`、`font-fallback`、`unsupported-style` 或未闭环的 `missing-render-evidence`。

视觉分数达到阈值不等同于所有元素均可编辑，因此报告还必须展示 `native/component/raster` 节点数量和覆盖范围。评审时以真实 Figma 导出的 PNG 为唯一视觉证据，以 bundle 单测作为协议证据，两者缺一不可。

## 实施阶段

### 1. 补齐协议和保真属性

扩展导出节点/填充类型及插件 facade，修复 Paint opacity 丢失，映射视觉字段，并为每一字段加导出与导入断言。将 `layoutStrategy` 设为绝对定位默认值，禁止未验证的 Auto Layout 重排。

### 2. 标注三页重建类型

依据现有 asset evidence 和节点角色，为真实样例标注 `native`、`component`、`raster`。只允许图片与不可分解装饰走栅格路径；检查每一张商品图裁切和每一段文本。

### 3. 实现真实 Figma 验证工件

在插件 UI 提供根 Frame PNG 导出与本地比较结果下载，使用现有 evaluator 图像比较函数复用统一容差。补齐报告 schema、失败提示和 diff 图路径。

### 4. 三页回归与收口

重新生成导入包，运行协议测试、类型检查和三页 bundle 回归；随后在 Figma 桌面端逐页导入、导出、比较，提交 PNG、diff、JSON 报告。任一页未通过，不更新 README 中的“已验证”表述。

## 风险与处理

- **字体不一致**：把 Figma 实际字体与回退写入报告；字体回退是阻塞，不用评分掩盖。
- **截图中有不可拆视觉**：允许小范围 raster region，但不可覆盖文本或交互控件；超过范围须人工补资产或重新标注。
- **Auto Layout 与几何冲突**：首期优先像素位置，Auto Layout 只用于验证通过的组件实例。
- **Figma 环境无法由 CI 模拟**：协议回归在 CI 中执行；最终视觉报告由真实 Figma 桌面端导出生成并作为可审计验收工件。

## 成功定义

三张真实活动页均有可复现的 Figma 导出 PNG 与报告，默认可见重建层通过视觉、几何、文本、裁切和降级门槛；业务 UI 保持原生可编辑，复杂视觉的栅格边界透明可见。届时可以诚实表述为“复杂活动页截图到高保真、可审计 Figma 的端到端链路已验证”。
