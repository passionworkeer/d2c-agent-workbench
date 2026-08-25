# 六维评测与定向修复

## 评分维度

每项 0–100 分，默认总分为等权平均；用户或企业规则给出权重时以其为准。

1. **布局还原（geometry）**：层级、尺寸、对齐、间距、网格和响应式。
2. **组件复用（componentReuse）**：是否正确使用现有组件、Props 和组合方式。
3. **Token 合规（tokenCompliance）**：是否引用语义 Token，是否出现无证据硬编码。
4. **视觉还原（visualFidelity）**：颜色、字体、圆角、阴影、图片与关键像素差异。
5. **语义结构（semanticStructure）**：HTML 语义、可访问性、内容顺序和交互状态。
6. **代码质量（codeQuality）**：类型、重复、边界、可读性、测试、构建和维护成本。

默认通过条件：总分至少 90，且任何单项不低于 80；构建失败、关键交互不可用或错误组件映射属于阻断项，不允许用平均分掩盖。

## 评测输入

- UISpec 与原始设计证据。
- 目标尺寸下的参考图与实现截图。
- 组件 / Token 映射表。
- 代码 Diff、Typecheck、测试和构建结果。
- 上一轮违规项和修复记录。

截图降级模式不评判无法证明的 Auto Layout 或变量绑定，但必须扣除结构置信度并保留限制说明。

## 违规项格式

```json
{
  "id": "token-spacing-01",
  "dimension": "tokenCompliance",
  "severity": "major",
  "evidence": "ProductGrid gap 使用 18px，仓库存在 spacing.lg",
  "expected": "var(--spacing-lg)",
  "location": "src/pages/ProductGrid.tsx:42",
  "repair": "替换为现有语义 Token"
}
```

每个违规项必须可定位、可验证，不能只写“页面不够像”。

## Repair 循环

1. 按阻断项、major、minor 排序。
2. 每轮只修改与当前违规项直接相关的文件。
3. 修改后重新运行相关 typecheck、测试、构建和截图。
4. 重新计算六维评分并记录分数变化。
5. 达到阈值、连续两轮无提升、出现需要用户决策的冲突或完成三轮时停止。

最多三轮是防止无边界视觉微调；没有实际变更时不计为一轮。

## 交付摘要

```text
初始评分：72
Repair 1：修复布局 Token 与组件 Variant，86（+14）
Repair 2：修复字体和响应式，94（+8）
最终状态：通过
剩余限制：截图输入无法验证 Figma 变量绑定
```

所有分数必须对应可检查证据；未运行视觉对比时，不给出伪精确的视觉分数。
