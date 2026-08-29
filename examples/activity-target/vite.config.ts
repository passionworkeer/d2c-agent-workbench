import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // 生成代码统一用 @/ 别名引用仓库组件（与 ActivitySpec component.importPath 对齐）
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  server: { host: "127.0.0.1" },
  preview: { host: "127.0.0.1" },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test-setup.ts",
  },
});
