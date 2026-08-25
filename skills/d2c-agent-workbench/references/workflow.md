# D2C 执行工作流

## 1. Inspect：建立输入清单

记录设计来源、目标仓库、框架、页面入口、允许修改范围、运行命令和验收阈值。若缺少信息，先从仓库文件中查找；只有会改变实现方向的缺口才询问用户。

输入模式只能取下列之一：

- `structured-figma`：有节点树、Auto Layout、组件和变量信息。
- `figma-export`：有节点 JSON 或导出资源，但结构字段不完整。
- `screenshot-fallback`：只有参考图，结构信息均视为未知。

## 2. UISpec：规范化设计意图

UISpec 至少包含：

```json
{
  "name": "页面名称",
  "viewport": { "width": 1440, "height": 900 },
  "hierarchy": [],
  "layout": { "direction": "vertical", "gap": "spacing.lg" },
  "responsive": [],
  "components": [],
  "tokens": [],
  "assets": [],
  "evidence": [],
  "unknowns": []
}
```

保留原始节点 ID 和变量 ID，方便追踪；截图模式把推断项放入 `unknowns`，不要伪造 ID。

## 3. Asset Retrieval：检索工程资产

先运行 `scripts/scan-design-assets.mjs`，再按当前设计语义读取少量高相关文件。不要一次性把整个组件库放入上下文。组件与 Token 规则见 `design-system-reuse.md`。

## 4. Mapping：形成可审核映射

每条组件映射使用：

```json
{
  "figmaNode": "ProductCard/Default",
  "codeComponent": "ProductCard",
  "importPath": "@company/ui/product-card",
  "props": { "tone": "accent", "size": "md" },
  "confidence": 0.94,
  "evidence": ["src/components/ProductCard.tsx", "stories/ProductCard.stories.tsx"]
}
```

低置信度候选不得直接进入生成计划。

## 5. Code Plan：先列修改边界

列出创建、修改和不触碰的文件；说明页面装配、数据边界、组件复用、Token 引用和响应式策略。计划必须包含仓库真实存在的验证命令。

## 6. Generate：生成可维护代码

- 遵守现有框架、目录和命名规范。
- 优先组合现有组件，避免复制其内部实现。
- 仅在没有合适资产时创建局部组件。
- 不为了像素还原破坏语义、键盘可用性或响应式。
- 只修改任务必需的文件。

## 7. Build / Render：获得运行证据

依次运行目标仓库的 typecheck、相关单测、生产构建和页面渲染。记录命令、退出码与页面 URL。构建失败先修复工程错误，再进行视觉评测。

## 8. Eval / Repair：职责分离

生成职责提供 UISpec、渲染结果和代码 Diff；评测职责独立给出违规项。两者可以由多 Agent 实现，也可以由同一运行时中的隔离上下文实现，但不能把“生成完成”当作“评测通过”。

Repair 仅处理评测明确指出的问题，最多三轮。完整标准见 `evaluation-and-repair.md`。

## 9. Deliver：进入研发流程

交付报告包含：输入模式、变更文件、复用证据、验证结果、最终评分、未解决问题与运行方式。若用户要求提交代码，再按目标仓库规则创建提交或 PR。
