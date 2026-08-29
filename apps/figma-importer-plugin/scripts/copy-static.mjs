import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// 把 manifest.json 与 ui.html 复制进 dist：Figma 加载 dist/code.js + dist/ui.html
const root = dirname(dirname(fileURLToPath(import.meta.url)));
await mkdir(join(root, "dist"), { recursive: true });
await copyFile(join(root, "manifest.json"), join(root, "dist", "manifest.json"));
await copyFile(join(root, "src", "ui.html"), join(root, "dist", "ui.html"));
