import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@d2c/contracts": resolve(__dirname, "../../contracts/src/index.ts"),
    },
  },
});
