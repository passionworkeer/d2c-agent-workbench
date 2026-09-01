import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { getFreePort, startPreviewServer } from "./seed";

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
  hasText?: boolean;
  effectiveBackgroundColor?: string | null;
}

export interface ViewportRender {
  name: string;
  width: number;
  height: number;
  screenshotPath: string;
  nodes: Record<string, NodeGeometry>;
  /** nodeId → element.textContent.trim()；评测用作文本一致性证据 */
  texts: Record<string, string>;
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
  /** 提供时在 cwd 启动 vite preview（自由端口）并以其地址为准渲染 */
  server?: { cwd: string; executable?: string };
}

/**
 * preview 起在自由端口，只替换调用方声明 URL 的 origin；路径必须原样保留——
 * 真实活动页样例渲染在注册路由（如 /commerce/feed），丢掉路径会落到根路由，
 * SPA 骨架的基线 padding 会把整页几何与像素对比全部带偏。
 */
export function composeRenderUrl(declaredUrl: string, serverUrl: string): string {
  const { pathname } = new URL(declaredUrl);
  if (pathname === "/" || pathname === "") return serverUrl;
  return `${serverUrl.replace(/\/$/, "")}${pathname}`;
}

export async function renderPage(input: RenderPageInput): Promise<RenderResult> {
  await mkdir(input.outputDir, { recursive: true });
  let baseUrl = input.url;
  let server: Awaited<ReturnType<typeof startPreviewServer>> | undefined;
  if (input.server) {
    const port = await getFreePort();
    server = await startPreviewServer({ cwd: input.server.cwd, port, executable: input.server.executable, timeoutMs: input.timeoutMs ?? 30_000 });
    baseUrl = composeRenderUrl(input.url, server.url);
  }
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const runtimeErrors: string[] = [];
  const renders: ViewportRender[] = [];
  try {
    browser = await chromium.launch({ headless: true });
    for (const viewport of input.viewports) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1, colorScheme: "light" });
      const page = await context.newPage();
      page.on("console", (message) => { if (message.type() === "error") runtimeErrors.push(message.text()); });
      page.on("pageerror", (error) => runtimeErrors.push(error.message));
      await page.goto(baseUrl, { waitUntil: "networkidle", timeout: input.timeoutMs ?? 30_000 });
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
        let effectiveBackgroundColor: string | null = null;
        for (let ancestor: HTMLElement | null = htmlElement; ancestor; ancestor = ancestor.parentElement) {
          const backdrop = getComputedStyle(ancestor);
          // 图像、渐变和半透明叠层无法仅靠单一 CSS 色值判定对比度。
          if (backdrop.backgroundImage !== "none" || Number(backdrop.opacity) < 1) break;
          if (backdrop.backgroundColor === "transparent" || /rgba\([^)]*,\s*0\)$/.test(backdrop.backgroundColor)) continue;
          if (backdrop.backgroundColor.startsWith("rgb(")) effectiveBackgroundColor = backdrop.backgroundColor;
          break;
        }
        return [htmlElement.dataset.d2cNodeId ?? "", {
          x: box.x, y: box.y, width: box.width, height: box.height,
          parentId: htmlElement.parentElement?.closest("[data-d2c-node-id]")?.getAttribute("data-d2c-node-id") ?? null,
          visible: style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0,
          overflowX: style.overflowX, overflowY: style.overflowY, position: style.position, zIndex: style.zIndex,
          color: style.color, backgroundColor: style.backgroundColor, fontFamily: style.fontFamily, fontSize: style.fontSize, lineHeight: style.lineHeight,
          hasText: !htmlElement.closest('[aria-hidden="true"]') && [...htmlElement.childNodes].some((child) => child.nodeType === Node.TEXT_NODE && Boolean(child.textContent?.trim())),
          effectiveBackgroundColor,
        }];
      }))) as Record<string, NodeGeometry>;
      // 文本证据：每个 d2c 节点的 textContent.trim()，去掉只含空白节点的干扰
      const texts = await page.locator("[data-d2c-node-id]").evaluateAll((elements) => Object.fromEntries(elements.map((element) => {
        const htmlElement = element as HTMLElement;
        const text = htmlElement.textContent?.trim() ?? "";
        return text ? [htmlElement.dataset.d2cNodeId ?? "", text] : [];
      }).filter((entry): entry is [string, string] => entry.length === 2))) as Record<string, string>;
      const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      const screenshotPath = resolve(input.outputDir, `${viewport.name}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true, animations: "disabled" });
      renders.push({ ...viewport, screenshotPath, nodes, texts, horizontalOverflow });
      await context.close();
    }
  } finally {
    try { await browser?.close(); } finally { await server?.dispose(); }
  }
  return { url: baseUrl, viewports: renders, runtimeErrors };
}
