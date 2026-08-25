---
name: d2c-agent-workbench
description: 将 Figma Bundle、节点树或参考图转换为可维护前端代码；当任务涉及 D2C、组件库与 Design Token 复用、UISpec、视觉评测或定向修复时使用。
---

# D2C Agent 工作台

把设计意图编译成可进入研发流程的代码。优先使用结构证据、团队组件和 Design Token；缺少企业资产时继续生成，但必须明确降级边界，不能伪造组件映射或 Figma 结构。

## 输入检查

开始前确认下列输入中实际可用的部分：

1. 设计输入：Figma Bundle、Figma API / MCP 结果、节点 JSON、导出资源或参考图。
2. 目标工程：仓库路径、技术栈、页面入口、路由、构建和测试命令。
3. 设计系统：组件源码、Storybook、Code Connect、Props / Variant、Token、主题、规范文档和历史页面。
4. 交付要求：目标页面、响应式范围、质量阈值、允许修改的目录和禁止触碰的文件。

不要要求 Figma MCP 才能继续。优先级为：结构化 Figma 数据 > Figma 导出资产 > 参考图。只有参考图时，进入“截图降级模式”。

## 资产决策

若用户给出目标仓库或企业资产路径，先运行：

```bash
node scripts/scan-design-assets.mjs <target-repository>
```

然后只读取与当前设计语义相关的候选。完整规则见 [设计系统复用](references/design-system-reuse.md)。

### 有组件库、Design System 或 Token

- 检索 Figma 组件名称、Variant、语义、Props 和历史调用的交集。
- 每个映射记录 Figma 节点、代码组件、import path、Props、置信度和文件证据。
- 优先引用现有 Token，不复制颜色、间距、字体、圆角和阴影常量。
- 置信度不足时列为待确认候选；不要把猜测写成确定映射。

### 没有企业资产

- 不阻塞生成。
- 从 UISpec 抽取局部可复用组件，集中定义样式变量。
- 使用语义标签、正常布局和明确 Props；避免重复结构、绝对定位堆叠与魔法数字扩散。
- 在交付报告中注明未提供团队组件库 / Token，并列出未来替换边界。

### 只有截图

- 可以生成视觉近似和响应式实现。
- 明确说明 Auto Layout、组件实例、变量绑定和节点语义缺少结构证据。
- 不声称已完成结构化 Figma D2C 或精确组件映射。

## 核心工作流

严格按以下顺序工作：

1. **Inspect**：确认输入、权限、目标路径与执行命令。
2. **UISpec**：把设计解析为层级、布局、尺寸、响应式、组件、Token 和资源清单。
3. **Asset Retrieval**：扫描并检索组件、Token、规范与历史资产。
4. **Mapping**：输出组件映射表和不确定项，不隐藏证据缺口。
5. **Code Plan**：列出文件、复用边界、页面装配方式和验证命令。
6. **Generate**：最小范围创建或修改代码，遵守目标仓库约定。
7. **Build / Render**：运行 TypeScript、测试、构建并渲染页面。
8. **Eval**：由独立评测职责检查六个维度，不依赖生成过程的自我判断。
9. **Repair**：按具体违规项定向修复，最多三轮。
10. **Deliver**：交付代码、Diff、组件证据、评分、遗留问题和复现命令。

详细协议见 [工作流](references/workflow.md) 与 [评测和修复](references/evaluation-and-repair.md)。

## 证据要求

最终交付必须包含：

- 输入模式及降级状态。
- UISpec 摘要与关键布局约束。
- 组件 / Token 映射表；未使用企业资产时说明原因。
- 实际修改文件与运行命令。
- Typecheck、测试、构建和页面渲染结果。
- 六维评分、每轮 Repair 前后差异和剩余限制。

任何未实际执行的命令都标记为“未执行”。任何未读取的组件源码都不能作为复用证据。

## 参考资料路由

- 需要逐步产物格式和职责边界：读 [workflow.md](references/workflow.md)。
- 需要组件召回、Token 绑定和置信度规则：读 [design-system-reuse.md](references/design-system-reuse.md)。
- 需要评分阈值、违规项和 Repair 停止条件：读 [evaluation-and-repair.md](references/evaluation-and-repair.md)。
- 需要有资产、无资产或截图降级示例：读 [examples.md](references/examples.md)。

只读取当前任务需要的参考文件，避免无关内容占用上下文。
