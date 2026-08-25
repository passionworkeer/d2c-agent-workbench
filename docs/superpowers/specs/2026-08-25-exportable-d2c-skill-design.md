# 可导出 D2C Skill 设计

## 目标

把 Web 控制台已经演示的 D2C 方法沉淀为一个可独立安装、可复用、可离线下载的 Agent Skill。用户点击“导出 D2C Skill”即可取得 ZIP；解压后得到完整 Skill，而不是一段提示词。

成功标准：

- Skill 覆盖设计输入、UISpec、组件和 Design Token 复用、代码生成、构建、评测、Repair 与交付报告。
- 用户提供组件资产库、Design System、Storybook、历史代码或仓库规范时，Skill 优先检索、约束与复用。
- 用户没有企业资产时，Skill 仍可生成语义清晰、组件化、可维护的代码，并明确记录未复用原因。
- Skill 包含详细参考资料、真实案例、配置样例和可执行的资产扫描脚本。
- Web 下载不依赖后端；ZIP 内容与仓库内 Skill 源码保持一致。
- 完整测试通过后同步到私有 GitHub 仓库默认分支。

## Skill 结构

Skill 的唯一源码位于：

```text
skills/d2c-agent-workbench/
├── SKILL.md
├── agents/
│   └── openai.yaml
├── references/
│   ├── workflow.md
│   ├── design-system-reuse.md
│   ├── evaluation-and-repair.md
│   └── examples.md
├── scripts/
│   └── scan-design-assets.mjs
└── assets/
    └── d2c-config.example.json
```

`SKILL.md` 保持可快速加载，只包含触发范围、输入判断、核心工作流、不可伪造的证据要求和参考资料路由。较长的组件检索方法、评分标准和案例放入 `references/`，避免每次调用都占用完整上下文。

## 能力与决策分支

Skill 启动后先建立资产清单：

1. 设计来源：Figma Bundle、Figma API / MCP、节点 JSON 或截图降级输入。
2. 工程来源：目标仓库、框架、路由、构建命令和代码约定。
3. 设计系统来源：组件源码、Props、Storybook、Code Connect、Token、主题和历史调用。

有设计系统资产时：

- 先执行扫描脚本并读取相关文件。
- 按 Figma 组件名称、Props / Variant、语义和历史用法召回候选。
- 输出组件映射、import path、置信度与证据。
- 颜色、间距、字体、圆角、阴影和响应式规则优先引用 Token。
- 置信度不足时请求确认，不把猜测伪装为确定映射。

没有设计系统资产时：

- 不阻塞任务。
- 根据 UISpec 生成局部可复用组件和集中样式变量。
- 避免重复结构、绝对定位堆叠和无语义标签。
- 在报告中注明“未提供团队组件库 / Token”，列出后续可替换边界。

只有截图时进入显式降级模式：允许完成视觉近似，但报告 Auto Layout、组件实例、变量绑定等结构证据缺失，不声称完成结构化 Figma D2C。

## 工作流

```text
检查输入与权限
→ 扫描设计系统和仓库资产
→ 解析设计并生成 UISpec
→ 检索组件与 Design Token
→ 输出代码计划
→ 生成或修改代码
→ TypeScript / Build / 页面渲染
→ 六维 Eval
→ 定向 Repair（最多三轮）
→ 输出代码、Diff、组件证据、评分和限制说明
```

Build Agent 负责理解、计划、生成、构建和修复；Eval Agent 在隔离上下文中检查结果。Skill 不要求必须创建多个运行时 Agent，但要求生成与评测职责分离。

## 附带脚本

`scan-design-assets.mjs <target-repository>` 使用 Node.js 内置模块，只读扫描目标目录，输出 JSON：

- 可能的 React / Vue / Svelte 组件文件。
- Storybook Stories、Code Connect 和组件导出入口。
- Token JSON、CSS Variables、Tailwind 和主题配置。
- package scripts、TypeScript 配置和常见仓库约定文件。

脚本不执行目标仓库代码、不安装依赖、不修改文件，并限制扫描数量，防止误扫大型生成目录。无匹配结果返回空数组和说明，而不是失败。

## ZIP 构建与一致性

`scripts/build-skill-zip.mjs` 递归读取 canonical Skill 目录，通过 `fflate` 生成：

```text
apps/web/public/d2c-agent-workbench-skill.zip
```

ZIP 内根目录为 `d2c-agent-workbench/`。构建排序固定；`--check` 模式解压现有 ZIP，并逐文件比较路径和内容。根脚本：

```text
pnpm skill:build
pnpm skill:check
```

全仓 `test` 先执行 `skill:check`，避免 Skill 源码更新后忘记重新生成 ZIP。

## Web 交互

顶部操作区新增“导出 D2C Skill”按钮，使用普通下载链接指向 `/d2c-agent-workbench-skill.zip`，带 `download` 属性。它与“上传 Figma 资产包”“运行完整演示”并列，但视觉级别低于主演示按钮。

按钮下载的是静态构建资产，因此仅启动 Vite 前端、后端不可用或现场断网时仍能使用。按钮旁不新增复杂配置弹窗；用户在解压后编辑 `assets/d2c-config.example.json` 或直接向 Agent 提供资产路径。

## 测试

- Skill Creator 官方 `quick_validate.py` 校验 frontmatter、命名和占位符。
- 运行 `scan-design-assets.mjs` 扫描本仓库，验证能发现 Web 组件、Token / CSS 和 package scripts，且不写入目标目录。
- ZIP 一致性测试验证所有 canonical 文件存在、内容相同且没有临时文件。
- Web 单测验证导出控件的下载文件名和 URL。
- Playwright 验证只启动前端时按钮可见，并实际下载 ZIP；解压后必须包含 `SKILL.md`、参考资料、脚本和配置样例。
- 最终执行 typecheck、全部测试、生产构建和 E2E。

## 范围边界

本次不实现 Skill 安装器、在线 Skill 市场、运行时配置编辑器、真实 Codex 调用或 Figma MCP。导出的是通用 Agent Skill 包；Web 的既有 D2C Mock 演示与真实上传协议保持不变。
