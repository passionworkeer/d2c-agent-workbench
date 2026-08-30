# Figma 高保真导入验收

每个真实样例都必须从 Figma Desktop 导出 PNG 并提交三件工件：`figma-export.png`、`figma-diff.png` 和 `figma-visual-report.json`。单元测试只证明协议；这些工件才证明真实 Figma 画面。

1. 运行 `pnpm -F @d2c/figma-importer-plugin build`。
2. 在 Figma Desktop 的开发插件中加载 `apps/figma-importer-plugin/manifest.json`。
3. 逐一导入 `examples/activity-pages/<fixture>/figma-import.json`：`commerce-feed`、`summer-game-festival`、`pet-red-packet`。
4. 点击“导出并验证”，把三个下载文件保存到 `docs/figma-validation/<fixture>/`。
5. 根 Frame 必须是 390×867，视觉分必须不低于 95；`font-fallback`、`missing-asset`、`unsupported-style` 是阻塞项。`missing-render-evidence` 会保留在报告中，但由 `spec.visual` 兜底时不阻塞离线样例验证。

隐藏的 `Reference（隐藏）` 仅用于人工叠图检查，导出前必须保持隐藏，不能作为默认画面或像素评分的底图。

每份报告可用以下命令复核（替换 fixture 名）：

```bash
node -e "const r=require('./docs/figma-validation/commerce-feed/figma-visual-report.json'); if(r.frame.width!==390||r.frame.height!==867||r.visual.score<95||r.degradations.some(x=>x.type!=='missing-render-evidence')) process.exit(1); console.log(r.visual.score)"
```
