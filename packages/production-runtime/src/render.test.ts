import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renderPage } from "./index";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("renderPage", () => {
  it("captures screenshots, runtime state and geometry for stable node ids", async () => {
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "text/html");
      response.end(`<!doctype html><html><head><style>*{transition:none!important}.hero{width:320px;height:120px}</style></head><body><main data-d2c-ready="true"><section class="hero" data-d2c-node-id="hero">Hero</section></main></body></html>`);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server did not bind");
    const outputDir = await mkdtemp(join(tmpdir(), "d2c-render-"));
    roots.push(outputDir);
    try {
      const result = await renderPage({
        url: `http://127.0.0.1:${address.port}`,
        outputDir,
        viewports: [{ name: "desktop", width: 1440, height: 900 }],
      });
      expect(result.viewports[0]?.screenshotPath).toMatch(/desktop\.png$/);
      expect(result.viewports[0]?.nodes.hero?.width).toBe(320);
      expect(result.viewports[0]?.nodes.hero?.height).toBe(120);
      expect(result.runtimeErrors).toEqual([]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 20_000);
});
