# Figma 高保真截图还原 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 让三张真实活动页从截图导入 Figma 后同时具备可审计的高保真画面和可编辑的原生业务节点，并以真实 Figma PNG 导出作为验收证据。

**Architecture:** ActivitySpec 仍是事实来源。figma-patcher 把实际样式映射为向后兼容的 v2 bundle 字段；插件默认绝对定位、完整写入 Figma 样式并保存隐藏参考层；插件 UI 从根 Frame 导出 PNG，在 Canvas 中与参考图比较并下载报告和 diff。

**Tech Stack:** TypeScript、Vitest、esbuild、Figma Plugin API、Canvas 2D、现有 JPEG 图集裁切逻辑。

---

## 变更地图

| 文件 | 责任 |
| --- | --- |
| packages/figma-patcher/src/export.ts | 定义高保真 bundle 字段，映射 visual，记录显式降级。 |
| packages/figma-patcher/src/export.test.ts | 固定 exporter 样式、字体回退、绝对布局和降级。 |
| apps/figma-importer-plugin/src/import.ts | FigmaFacade 属性映射、隐藏参考层、默认绝对布局与解析校验。 |
| apps/figma-importer-plugin/src/import.test.ts | 用 facade 假实现验证实际写入 Figma 的字段。 |
| apps/figma-importer-plugin/src/visual-report.ts | 无 DOM 依赖的像素差异、差异簇和报告类型。 |
| apps/figma-importer-plugin/src/visual-report.test.ts | 固定像素阈值、尺寸异常和差异簇。 |
| apps/figma-importer-plugin/src/code.ts | 真实 Figma adapter、根 Frame PNG 导出、UI 消息桥。 |
| apps/figma-importer-plugin/src/ui.html、src/ui.ts | 文件选择、导入、验证、Canvas 比对与下载。 |
| apps/figma-importer-plugin/package.json | 构建 ui.ts 到 dist/ui.js。 |
| apps/figma-importer-plugin/src/generate-bundles.test.ts | 重生三页 JSON 并检查分类、样式和裁切。 |
| examples/activity-pages/*/figma-import.json | 三页新的 bundle 基线。 |
| docs/figma-validation/README.md | Figma Desktop 导入、导出、报告与人工签收。 |
| README.md | 仅在真实三页工件齐备后更新验证状态。 |

### Task 1: 扩展 bundle 的高保真样式契约

**Files:**
- Modify: packages/figma-patcher/src/export.ts
- Modify: packages/figma-patcher/src/export.test.ts

- [ ] **Step 1: 先写 exporter 的失败测试**

在 export.test.ts 添加最小 ActivitySpec：卡片 visual 含 opacity: .85、borderRadius: 12、border: "1px solid rgba(255,255,255,.4)"、shadow: "0 2px 8px rgba(0,0,0,.18)"；文本含 fontFamily: "PingFang SC"、lineHeight: 20、letterSpacing: 1、textAlign: "center"。断言：

~~~ts
expect(card).toMatchObject({
  opacity: .85, cornerRadius: 12, layoutStrategy: "absolute", renderKind: "native",
  strokes: [{ type: "SOLID", weight: 1, color: { r: 255, g: 255, b: 255 }, opacity: .4 }],
  effects: [{ type: "DROP_SHADOW", offset: { x: 0, y: 2 }, radius: 8,
    color: { r: 0, g: 0, b: 0, a: .18 } }],
});
expect(title).toMatchObject({
  fontFamily: "PingFang SC", lineHeight: 20, letterSpacing: 1,
  textAlignHorizontal: "CENTER", renderKind: "native",
});
expect(image).toMatchObject({ renderKind: "raster" });
~~~

对 border: "dashed red" 和 shadow: "var(--shadow)" 断言 bundle.degradations 含 { type: "unsupported-style", nodeId, property, value }，不能静默丢弃。

- [ ] **Step 2: 运行失败测试**

Run: pnpm -F @d2c/figma-patcher test -- src/export.test.ts

Expected: FAIL，提示 cornerRadius、layoutStrategy、renderKind 或 unsupported-style 尚不存在。

- [ ] **Step 3: 定义向后兼容的 exporter 类型**

在 export.ts 既有类型旁增加：

~~~ts
export interface FigmaExportStroke {
  type: "SOLID"; color: { r: number; g: number; b: number }; opacity?: number; weight: number;
}
export interface FigmaExportEffect {
  type: "DROP_SHADOW"; color: { r: number; g: number; b: number; a: number };
  offset: { x: number; y: number }; radius: number;
}
export type FigmaExportLayoutStrategy = "absolute" | "auto";
export type FigmaExportRenderKind = "native" | "raster";
~~~

FigmaExportNode 增加可选 opacity、cornerRadius、strokes、effects、clipsContent、lineHeight、letterSpacing、textAlignHorizontal、layoutStrategy、renderKind。FigmaImportDegradation.type 扩为 "missing-render-evidence" | "unsupported-style"，并增加可选 property、value。

- [ ] **Step 4: 实现受限 CSS 解析和字段映射**

在 parseColor 后实现只接受样例语法的解析器，不猜测渐变、多重阴影或任意 CSS。

~~~ts
function parseBorder(value: string | undefined): FigmaExportStroke | undefined {
  const match = /^(\d+(?:\.\d+)?)px\s+solid\s+(.+)$/i.exec(value?.trim() ?? "");
  const color = match ? parseColor(match[2]) : undefined;
  return match && color ? { type: "SOLID", weight: Number(match[1]),
    color: { r: color.r, g: color.g, b: color.b },
    ...(color.alpha !== undefined && color.alpha < 1 ? { opacity: color.alpha } : {}) } : undefined;
}
function parseShadow(value: string | undefined): FigmaExportEffect | undefined {
  const match = /^(0|-?\d+(?:\.\d+)?px)\s+(-?\d+(?:\.\d+)?)px\s+(\d+(?:\.\d+)?)px\s+(rgba?\(.+\))$/i.exec(value?.trim() ?? "");
  const color = match ? parseColor(match[4]) : undefined;
  return match && color ? { type: "DROP_SHADOW",
    offset: { x: Number(match[1].replace("px", "")), y: Number(match[2]) }, radius: Number(match[3]),
    color: { r: color.r, g: color.g, b: color.b, a: color.alpha ?? 1 } } : undefined;
}
~~~

toFigmaNode 使用 styles.fontFamily ?? node.visual.fontFamily；映射 visual.opacity、borderRadius、lineHeight、letterSpacing 与 { left: "LEFT", center: "CENTER", right: "RIGHT", justify: "JUSTIFIED" }。page 或 overflow: "hidden" 设 clipsContent: true。每个节点固定 layoutStrategy: "absolute"；content.assetId 节点为 renderKind: "raster"，其余为 "native"。不能解析的非空 border/shadow 进入递归共享 degradation 数组。

- [ ] **Step 5: 验证并提交 exporter 改动**

Run: pnpm -F @d2c/figma-patcher test -- src/export.test.ts

Expected: PASS，原有颜色/裁切测试和新增样式/降级测试都通过。

~~~bash
git add packages/figma-patcher/src/export.ts packages/figma-patcher/src/export.test.ts
git commit -m "feat(figma): 导出高保真样式与显式降级"
~~~

### Task 2: 让 importer 写入样式并保持截图坐标

**Files:**
- Modify: apps/figma-importer-plugin/src/import.ts
- Modify: apps/figma-importer-plugin/src/import.test.ts
- Modify: packages/figma-patcher/src/export.ts

- [ ] **Step 1: 为 facade 写失败测试**

扩展当前 fixture 的卡片、文字和半透明 fill。断言导入后的 facade node：

~~~ts
expect(card).toMatchObject({
  opacity: .85, cornerRadius: 12, clipsContent: true,
  strokes: [{ type: "SOLID", weight: 1, opacity: .4 }],
  effects: [{ type: "DROP_SHADOW", offset: { x: 0, y: 2 }, radius: 8 }],
});
expect(title).toMatchObject({
  lineHeight: { unit: "PIXELS", value: 20 }, letterSpacing: { unit: "PIXELS", value: 1 },
  textAlignHorizontal: "CENTER",
});
expect(card.fills[0]).toMatchObject({ type: "SOLID", opacity: .62 });
~~~

把原 maps flex layout onto Auto Layout 改为：layoutStrategy: "absolute" 时不设 Auto Layout，子节点仍保留相对坐标；仅显式 layoutStrategy: "auto" 时断言 VERTICAL、gap 与 padding。

- [ ] **Step 2: 运行失败测试**

Run: pnpm -F @d2c/figma-importer-plugin test -- src/import.test.ts

Expected: FAIL，现有 facade 未保存 opacity、排版属性，默认 Auto Layout 行为也不符合断言。

- [ ] **Step 3: 扩展 facade 并复制 Figma 属性**

FigmaFacadePaint 增加 opacity?: number。FigmaFacadeNode 增加：

~~~ts
opacity?: number; cornerRadius?: number; strokes?: FigmaFacadePaint[];
effects?: Array<{ type: "DROP_SHADOW"; color: { r: number; g: number; b: number; a: number };
  offset: { x: number; y: number }; radius: number }>;
clipsContent?: boolean; visible?: boolean; locked?: boolean;
lineHeight?: { unit: "PIXELS"; value: number };
letterSpacing?: { unit: "PIXELS"; value: number };
textAlignHorizontal?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
~~~

在 importNode 创建后、appendChild 前应用字段。SOLID fill 必须执行：

~~~ts
node.fills.push({ type: "SOLID", color: fill.color,
  ...(fill.opacity !== undefined ? { opacity: fill.opacity } : {}) });
~~~

TEXT 写 lineHeight、letterSpacing、textAlignHorizontal；非 TEXT 写圆角、描边、阴影、透明度和裁剪。

- [ ] **Step 4: 仅允许显式 Auto Layout，并保存语义**

把 applyLayout 首行改为 if (source.layoutStrategy !== "auto") return;。继续保存 d2cNodeId，另外写入 d2cLayout = JSON.stringify(source.layout)，供后续组件化使用。旧 v2 包也安全默认绝对布局。

- [ ] **Step 5: 添加隐藏 Reference 层**

在 FigmaImportBundle.manifest 增加 referenceAssetId?: string。真实样例导出时引用唯一嵌入图集 id。根节点导入后，若 asset 存在，创建名为 Reference（隐藏） 的 0,0、根尺寸 rectangle，写全图 IMAGE fill，设置 visible = false、locked = true，并写 d2cReference = "true"。asset 不存在则写 missing-asset degradation。测试验证它默认隐藏、锁定且不改根节点坐标。

- [ ] **Step 6: 验证并提交 importer 改动**

Run: pnpm -F @d2c/figma-importer-plugin test -- src/import.test.ts

Expected: PASS，覆盖坐标、fill opacity、节点样式、绝对布局、显式 Auto Layout、裁切、参考层。

~~~bash
git add apps/figma-importer-plugin/src/import.ts apps/figma-importer-plugin/src/import.test.ts packages/figma-patcher/src/export.ts
git commit -m "fix(figma): 导入完整样式并保持截图坐标"
~~~

### Task 3: 重生并锁定三个真实 bundle

**Files:**
- Modify: apps/figma-importer-plugin/src/generate-bundles.test.ts
- Modify: examples/activity-pages/commerce-feed/figma-import.json
- Modify: examples/activity-pages/summer-game-festival/figma-import.json
- Modify: examples/activity-pages/pet-red-packet/figma-import.json

- [ ] **Step 1: 添加三页 bundle 的失败断言**

在 fixture 循环增加 flatten(nodes)。每页断言：

~~~ts
expect(bundle.manifest.referenceAssetId).toBe("reference");
expect(flatten(bundle.nodes).filter((node) => node.type === "TEXT")
  .every((node) => node.renderKind === "native")).toBe(true);
expect(flatten(bundle.nodes).filter((node) => node.renderKind === "raster")
  .every((node) => node.type === "RECTANGLE" && node.imageCrop)).toBe(true);
expect(flatten(bundle.nodes).filter((node) => node.layoutStrategy !== "absolute")).toEqual([]);
expect(bundle.degradations.filter((item) => item.type === "unsupported-style")).toEqual([]);
~~~

对 spec 中带 borderRadius、shadow、textAlign、letterSpacing 或非 1 opacity 的每个 node，与 bundle 同 id node 对照，断言 Figma 字段存在，不能用 JSON 字符串计数代替。

- [ ] **Step 2: 运行失败测试**

Run: pnpm -F @d2c/figma-importer-plugin test -- src/generate-bundles.test.ts

Expected: FAIL，直到新字段、reference 元数据和绝对布局已实现。

- [ ] **Step 3: 再生 JSON 并审查 diff**

Run: pnpm -F @d2c/figma-importer-plugin test -- src/generate-bundles.test.ts

Expected: PASS，测试重写三份 JSON。

~~~bash
git diff -- examples/activity-pages/commerce-feed/figma-import.json examples/activity-pages/summer-game-festival/figma-import.json examples/activity-pages/pet-red-packet/figma-import.json
~~~

Expected: 只有样式、分类、绝对布局和 reference 元数据变化；原文案、base64 和已验证 imageCrop 无无关改动。

- [ ] **Step 4: 验证并提交 bundle 基线**

Run: pnpm -F @d2c/figma-importer-plugin test -- src/generate-bundles.test.ts src/import.test.ts

Expected: PASS，三份再生 JSON 都被 parseFigmaImportBundle 接受。

~~~bash
git add apps/figma-importer-plugin/src/generate-bundles.test.ts examples/activity-pages/commerce-feed/figma-import.json examples/activity-pages/summer-game-festival/figma-import.json examples/activity-pages/pet-red-packet/figma-import.json
git commit -m "test(figma): 锁定三张活动页高保真导入基线"
~~~

### Task 4: 导出根 Frame PNG 并在插件 UI 生成视觉报告

**Files:**
- Create: apps/figma-importer-plugin/src/visual-report.ts
- Create: apps/figma-importer-plugin/src/visual-report.test.ts
- Modify: apps/figma-importer-plugin/src/code.ts
- Modify: apps/figma-importer-plugin/src/ui.html
- Create: apps/figma-importer-plugin/src/ui.ts
- Modify: apps/figma-importer-plugin/package.json

- [ ] **Step 1: 写像素算法失败测试**

新建 visual-report.test.ts，构造 2×2 RGBA。相同图片断言 score: 100、零差异、空 clusters；仅右上一个超容差像素断言 differentPixels: 1、score: 75、簇 { left: 1, top: 0, right: 1, bottom: 0, pixels: 1 }；相邻差异合并；尺寸不同抛出 尺寸不一致。

~~~ts
comparePixelImages(
  { width: 2, height: 2, data: new Uint8ClampedArray([...]) },
  { width: 2, height: 2, data: new Uint8ClampedArray([...]) },
  { channelTolerance: 8, minClusterPixels: 1 },
);
~~~

- [ ] **Step 2: 运行失败测试**

Run: pnpm -F @d2c/figma-importer-plugin test -- src/visual-report.test.ts

Expected: FAIL，报找不到 ./visual-report。

- [ ] **Step 3: 实现纯像素比较模块**

新模块只用 TypedArray：

~~~ts
export interface PixelImage { width: number; height: number; data: Uint8ClampedArray; }
export interface DiffCluster { left: number; top: number; right: number; bottom: number; pixels: number; }
export interface PixelComparison {
  score: number; differentPixels: number; totalPixels: number;
  clusters: DiffCluster[]; diffMask: Uint8Array;
}
export function comparePixelImages(reference: PixelImage, actual: PixelImage,
  options?: { channelTolerance?: number; minClusterPixels?: number }): PixelComparison;
~~~

尺寸或 data.length !== width * height * 4 时抛错。以 RGBA 最大通道绝对差判断像素差异，写 diffMask；四邻域 flood-fill 生成 clusters，过滤小于 minClusterPixels 的簇。分数固定为 Math.round((1 - differentPixels / totalPixels) * 10_000) / 100。

- [ ] **Step 4: 让 code.ts 导出真实 Figma PNG**

扩展 FigmaGlobalNode：

~~~ts
exportAsync(settings: {
  format: "PNG"; constraint: { type: "SCALE"; value: number };
}): Promise<Uint8Array>;
~~~

导入成功后保存 lastRootIds。处理 UI 消息 { type: "export-root-png", rootId }：拒绝不属于集合的 id，调用 root.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: 1 } })，再发送 { type: "figma-root-png", rootId, bytes: Array.from(bytes), width: root.width, height: root.height }。错误用现有 error 消息但前缀 PNG 导出失败。不改 manifest 的零网络权限。

- [ ] **Step 5: 构建 UI 并生成可下载工件**

把 ui.html 内联脚本迁到 ui.ts，HTML 只保留 DOM 和 script src="ui.js"。导入成功后显示 导出并验证。ui.ts 从 manifest.referenceAssetId 读取内嵌图集，将 reference 与 Figma PNG 画为根 Frame 尺寸的 Canvas，再调用：

~~~ts
const reference = await decodeToCanvas(referenceDataUrl, width, height);
const actual = await decodeToCanvas(
  URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "image/png" })), width, height);
const comparison = comparePixelImages(readCanvas(reference), readCanvas(actual));
~~~

由 diffMask 输出透明红色 PNG；下载 figma-export.png、figma-diff.png、figma-visual-report.json。报告含 fixture 名、尺寸、comparison、bundle/import degradations、native/raster node 数。缺 reference、尺寸不等于 viewport、分数低于 95 或任一 degradation 时，UI 显示失败，禁止显示 已验证。

- [ ] **Step 6: 更新构建、验证并提交**

将 package build 改为：

~~~json
"build": "esbuild src/code.ts --bundle --format=iife --target=es2020 --outfile=dist/code.js && esbuild src/ui.ts --bundle --format=iife --target=es2020 --outfile=dist/ui.js && node scripts/copy-static.mjs"
~~~

Run: pnpm -F @d2c/figma-importer-plugin test && pnpm -F @d2c/figma-importer-plugin typecheck && pnpm -F @d2c/figma-importer-plugin build

Expected: PASS，dist/code.js、dist/ui.js、dist/ui.html 均生成。

~~~bash
git add apps/figma-importer-plugin/src/visual-report.ts apps/figma-importer-plugin/src/visual-report.test.ts apps/figma-importer-plugin/src/code.ts apps/figma-importer-plugin/src/ui.ts apps/figma-importer-plugin/src/ui.html apps/figma-importer-plugin/package.json
git commit -m "feat(figma): 导出画面并生成本地视觉报告"
~~~

### Task 5: 三页真实 Figma 验收和文档收口

**Files:**
- Create: docs/figma-validation/README.md
- Create: docs/figma-validation/{commerce-feed,summer-game-festival,pet-red-packet}/figma-export.png
- Create: docs/figma-validation/{commerce-feed,summer-game-festival,pet-red-packet}/figma-diff.png
- Create: docs/figma-validation/{commerce-feed,summer-game-festival,pet-red-packet}/figma-visual-report.json
- Modify: README.md

- [ ] **Step 1: 写验收说明和报告检查命令**

新建 docs/figma-validation/README.md：先运行 plugin build，在 Figma Desktop 以开发插件加载 apps/figma-importer-plugin/manifest.json；逐页选择对应 figma-import.json，导入，点击 导出并验证，把三件下载工件存入 fixture 目录。要求根 Frame 为 390×867；打开 Reference（隐藏）只能用于人工叠图，最终导出前必须关闭。

每份报告执行以下命令，替换 fixture 名逐页运行：

~~~bash
node -e "const r=require('./docs/figma-validation/commerce-feed/figma-visual-report.json'); if(r.frame.width!==390||r.frame.height!==867||r.visual.score<95||r.degradations.length) process.exit(1); console.log(r.visual.score)"
~~~

- [ ] **Step 2: 在真实 Figma Desktop 逐页导入、导出和复核**

依次对 commerce-feed、summer-game-festival、pet-red-packet 执行 Step 1。每页必须满足：visual.score >= 95、尺寸 390×867、文本/按钮/导航为 native、无 font-fallback、missing-asset、unsupported-style 或未闭环 missing-render-evidence。任一失败时提交 diff 作诊断并回到对应任务修复，不更新成功文案。

- [ ] **Step 3: 在证据齐备后更新 README 并跑全量回归**

仅当三页均通过时，将 README 的 人工导入验证仍待完成 改为已由 docs/figma-validation/ 中的 PNG、diff 和报告验证，并保留 raster 边界说明。

Run:

~~~bash
pnpm -F @d2c/figma-patcher test
pnpm -F @d2c/figma-importer-plugin test
pnpm typecheck
pnpm test
git diff --check
~~~

Expected: 所有命令退出 0。若并行根测试有既有资源争用超时，记录失败名称后按 package filter 隔离重跑；不能把超时当通过。

- [ ] **Step 4: 提交验收工件**

~~~bash
git add README.md docs/figma-validation
git commit -m "test(figma): 验证三张活动页高保真导入"
~~~

## 交付前核对

- [ ] 三份包使用绝对布局，三层嵌套坐标测试仍通过。
- [ ] fill opacity、节点 opacity、圆角、阴影、描边、对齐、字距、行高都有 exporter 和 importer 测试。
- [ ] 文本/按钮/导航未 raster 化；每个 raster 节点都是带证据裁切的图片矩形。
- [ ] 插件仍零网络访问，三份 bundle 仍自包含。
- [ ] 三份真实 Figma PNG、diff、报告都已提交且视觉分不低于 95。
- [ ] README 只陈述这些工件确实证明的能力。
