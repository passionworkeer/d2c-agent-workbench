import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

export interface RenderViewport {
  name: string;
  width: number;
  height: number;
}

export interface NodeGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  parentId: string | null;
  visible: boolean;
  overflowX: string;
  overflowY: string;
  position: string;
  zIndex: string;
  color: string;
  backgroundColor: string;
  fontFamily: string;
  fontSize: string;
  lineHeight: string;
}

export interface ViewportRender {
  name: string;
  width: number;
  height: number;
  screenshotPath: string;
  nodes: Record<string, NodeGeometry>;
  horizontalOverflow: boolean;
}

export interface RenderResult {
  url: string;
  viewports: ViewportRender[];
  runtimeErrors: string[];
}

export interface RenderPageInput {
  url: string;
  outputDir: string;
  viewports: RenderViewport[];
  timeoutMs?: number;
}

export async function renderPage(input: RenderPageInput): Promise<RenderResult> {
  await mkdir(input.outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const runtimeErrors: string[] = [];
  const renders: ViewportRender[] = [];
  try {
    for (const viewport of input.viewports) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1, colorScheme: "light" });
      const page = await context.newPage();
      page.on("console", (message) => { if (message.type() === "error") runtimeErrors.push(message.text()); });
      page.on("pageerror", (error) => runtimeErrors.push(error.message));
      await page.goto(input.url, { waitUntil: "networkidle", timeout: input.timeoutMs ?? 30_000 });
      await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}" });
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].map((image) => image.complete ? Promise.resolve() : new Promise<void>((done) => {
          image.addEventListener("load", () => done(), { once: true });
          image.addEventListener("error", () => done(), { once: true });
        })));
      });
      await page.locator("[data-d2c-ready=true]").first().waitFor({ state: "attached", timeout: input.timeoutMs ?? 30_000 });
      const nodes = await page.locator("[data-d2c-node-id]").evaluateAll((elements) => Object.fromEntries(elements.map((element) => {
        const htmlElement = element as HTMLElement;
        const box = htmlElement.getBoundingClientRect();
        const style = getComputedStyle(htmlElement);
        return [htmlElement.dataset.d2cNodeId ?? "", {
          x: box.x, y: box.y, width: box.width, height: box.height,
          parentId: htmlElement.parentElement?.closest("[data-d2c-node-id]")?.getAttribute("data-d2c-node-id") ?? null,
          visible: style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0,
          overflowX: style.overflowX, overflowY: style.overflowY, position: style.position, zIndex: style.zIndex,
          color: style.color, backgroundColor: style.backgroundColor, fontFamily: style.fontFamily, fontSize: style.fontSize, lineHeight: style.lineHeight,
        }];
      }))) as Record<string, NodeGeometry>;
      const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      const screenshotPath = resolve(input.outputDir, `${viewport.name}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true, animations: "disabled" });
      renders.push({ ...viewport, screenshotPath, nodes, horizontalOverflow });
      await context.close();
    }
  } finally {
    await browser.close();
  }
  return { url: input.url, viewports: renders, runtimeErrors };
}
