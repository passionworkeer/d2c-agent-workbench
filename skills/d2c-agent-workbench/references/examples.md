# D2C 使用案例

## 案例 A：存在企业组件库和 Token

**输入**：Figma Bundle、React 仓库、`packages/ui`、Storybook 和 `tokens/semantic.json`。

**执行**：

1. 扫描仓库发现 `ProductCard`、`Header` 和语义颜色 Token。
2. 读取组件 Props、Stories 与现有电商页面 import。
3. 把 Figma `商品卡片/默认` 映射到 `ProductCard`，置信度 0.94。
4. 使用 `spacing.lg`、`radius.card` 和 `color.surface.accent`。
5. 生成页面装配代码，不复制组件内部样式。
6. 构建后评测发现错误 `density` Variant，定向修复并复验。

**交付**：代码 Diff、映射证据、构建结果、72 → 94 的两轮评分记录。

## 案例 B：没有组件库和 Design Token

**输入**：结构化节点 JSON、空白 Vite React 工程。

**执行**：

1. UISpec 提取 Header、ProductGrid 和 ProductCard 重复结构。
2. 因无团队资产，创建局部 `ProductCard`，Props 仅覆盖实际 Variant。
3. 在页面局部样式中集中定义颜色、间距和圆角变量。
4. 运行 typecheck、单测、构建和页面截图。

**交付说明**：

```text
企业资产：未提供
复用策略：创建页面级可复用 ProductCard
未来替换点：ProductCard import 与 6 个局部样式变量
```

不要因此停止任务，也不要声称使用了企业 Design System。

## 案例 C：只有参考图

**输入**：1440 × 900 页面截图和目标仓库。

**执行**：

1. 标记 `screenshot-fallback`。
2. 从视觉层级推断布局和断点，把推断项写入 UISpec `unknowns`。
3. 仍扫描仓库并按页面语义寻找可复用组件。
4. 生成视觉近似、渲染对比并修复明显差异。

**限制说明**：

```text
缺失证据：Auto Layout、原始节点 ID、组件实例、变量绑定
可以验证：目标视口视觉、响应式行为、代码结构、实际组件 import
不可声称：结构化 Figma 还原完成
```

## 推荐调用提示

```text
使用 $d2c-agent-workbench 处理这个设计资产。目标工程在 ./web，先扫描 ./packages/ui 和 ./tokens；存在高置信度组件时优先复用，没有匹配时继续生成局部组件。完成构建、页面评测和最多三轮定向修复，并报告组件证据与限制。
```
