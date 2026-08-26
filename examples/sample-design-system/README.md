# SDS 企业组件资产库样本

`examples/sample-design-system/` 是一个最小但真实的「企业设计系统仓库」切片，回答面试官的
「怎么接我们公司设计系统」：**不需要改 workbench 代码，把仓库扫描一遍就能注册进 matcher**。

```
components/
  Header.tsx        Header.stories.tsx    Header.figma.tsx
  ProductCard.tsx   ProductCard.stories.tsx   ProductCard.figma.tsx
  Button.tsx        Button.stories.tsx    Button.figma.tsx
  Input.tsx         Input.stories.tsx     Input.figma.tsx
  Badge.tsx         Badge.stories.tsx     Badge.figma.tsx
  Text.tsx          Text.stories.tsx      Text.figma.tsx
```

- **组件**：真实 React 实现（Props 类型 + className 样式约定，`sds-` 前缀，无 Tailwind 依赖）
- **Storybook**：`*.stories.tsx` 声明 title 与 argTypes 控件
- **Code Connect**：`*.figma.tsx` 用 `figma.connect(Component, figma.node("<key>"), { variantProps })`
  绑定 Figma 端组件

## 扫描约定（`@d2c/asset-indexer` 依赖的契约）

| 约定 | 位置 | 扫描结果字段 |
|---|---|---|
| `export function ProductCard(...)` 或 `export const ProductCard =` | `*.tsx`（大写开头文件名） | `codeComponent` |
| `components/` 下的相对路径 | — | `importPath`（`@/components/<Name>`，可配 aliasPrefix） |
| `export const figmaComponentNames = ["Product Card / Default", ...]` | `<Name>.figma.tsx` | `figmaNames` |
| `figma.connect(...)` / `figma.node("<key>")` | `<Name>.figma.tsx` | `codeConnect.nodeKeys` |
| `title: "SDS/ProductCard"` | `<Name>.stories.tsx` | `storybook.title` |
| `argTypes: { tone: { control: "select" } }` | `<Name>.stories.tsx` | `storybook.argTypes` / `props` |

约定刻意从简（正则可解析、人可读）；换公司组件库时只需满足同一约定，或扩展
`packages/asset-indexer/src/index.ts` 的解析器（单文件解析失败不阻断扫描，附 `parseError`）。

## 与 matcher 的衔接

```ts
import { scanRepo } from "@d2c/asset-indexer";
import { buildRegistryFromEntries, mapSdsComponents } from "@d2c/component-matcher";

const entries = await scanRepo({ repoRoot: "examples/sample-design-system" });
const registry = buildRegistryFromEntries(entries);
const mappings = mapSdsComponents(spec, registry); // 注入企业 registry，缺省用内置静态表
```

`packages/asset-indexer/src/index.test.ts` 钉死：扫描出的 registry 与 component-matcher
内置静态表在 product-grid fixture 上产出**逐字节一致**的映射（防回归）。

## 本目录不参与构建

`examples/sample-design-system` 不在 pnpm workspace 内（`pnpm-workspace.yaml` 只含
`packages/*` 与 `apps/*`），仓库内不安装 react / storybook / code-connect 依赖。
要本地跑 Storybook：`npm install && npm run storybook`。

服务端 `GET /api/health?scan=dynamic` 会实时扫描本目录并返回动态 registry 大小
（结果缓存，单进程只扫一次）。
