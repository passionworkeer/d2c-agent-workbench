# 开源依赖许可证审计

> 审计日期：2026-08-29 · 工具：`pnpm licenses list --prod`（生产依赖全集，含传递依赖）

## 结论

**全部为宽松许可证，无 copyleft（GPL/AGPL/SSPL）成分，可安全用于商业交付。**

| 许可证 | 包数 | 说明 |
|---|---|---|
| MIT | 136 | 含全部核心直接依赖 |
| BSD-3-Clause | 7 | 含 color-diff、jpeg-js 等 |
| Apache-2.0 | 4 | Playwright 系列 |
| ISC | 5 | 含 lucide-react |
| BlueOak-1.0.0 | 2 | minimatch、sax |
| (MIT AND Zlib) | 1 | pako |
| 0BSD | 1 | tslib |
| Unknown | 1 | color-convert（实际为 MIT，npm 元数据缺失 license 字段所致，见下） |

## 直接依赖（生产链路）

| 依赖 | 用途 | 许可证 |
|---|---|---|
| react / react-dom | UI 运行时 | MIT |
| fastify / @fastify/multipart | API 服务 | MIT |
| zod | 协议 Schema | MIT |
| fflate | zip 解包 | MIT |
| looks-same | 像素级 Diff | MIT |
| jimp | 素材 pHash | MIT |
| ts-morph | TSX AST 补丁 | MIT |
| @measured/puck | 可编辑原型 | MIT |
| @playwright/test | 多视口渲染评测 | Apache-2.0 |
| lucide-react | 图标 | ISC |
| vite / @vitejs/plugin-react / typescript | 目标仓库构建工具链（examples/activity-target） | MIT |

## 已知说明

- **color-convert**（BSD-2-Clause 的 @icc/color-space 与 MIT 实现的传递依赖）：npm 元数据未声明 license 字段，被 pnpm 标记为 Unknown；其上游仓库为 MIT。仅作为 @measured/puck 的传递依赖引入，不进生产 bundle 关键路径。
- **版本锁定**：所有依赖经 pnpm-lock.yaml 锁定；`examples/activity-target` 自带独立 lockfile（供应链边界见其 pnpm-workspace.yaml `allowBuilds` 白名单，仅放行 esbuild）。
- 本文档由 `pnpm licenses list --prod` 生成核对；依赖变更后请重新执行并更新本表。
