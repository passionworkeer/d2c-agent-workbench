import { importBundle, parseFigmaImportBundle, type FigmaFacade, type FigmaFacadeNode } from "./import";

// Figma 插件运行时：把 FigmaFacade 适配到真实 figma API，处理 UI 消息并回传导入报告。
// 安全约束：不发起任何网络请求，不读取任何令牌/凭证/文件系统——
// 唯一输入是用户在 UI 里显式选择的本地 JSON 导入包。

interface FigmaGlobalNode {
  id: string;
  name: string;
  x: number;
  y: number;
  readonly width: number;
  readonly height: number;
  resize(width: number, height: number): void;
  fills: unknown[];
  layoutMode?: "NONE" | "HORIZONTAL" | "VERTICAL";
  itemSpacing?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  characters?: string;
  fontSize?: number;
  fontName?: { family: string; style: string };
  visible?: boolean;
  locked?: boolean;
  exportAsync(settings: { format: "PNG"; constraint: { type: "SCALE"; value: number } }): Promise<Uint8Array>;
  appendChild(child: FigmaGlobalNode): void;
  setPluginData(key: string, value: string): void;
}

interface FigmaGlobal {
  base64Decode(data: string): Uint8Array;
  createFrame(): FigmaGlobalNode;
  createText(): FigmaGlobalNode;
  createRectangle(): FigmaGlobalNode;
  createImage(bytes: Uint8Array): { hash: string };
  loadFontAsync(fontName: { family: string; style: string }): Promise<void>;
  getNodeById(id: string): FigmaGlobalNode | null;
  showUI(html: string, options?: { width?: number; height?: number }): void;
  ui: {
    onmessage: ((message: { type: string; bundle?: unknown; rootId?: string }) => void) | undefined;
    postMessage(message: { type: string; message?: string; report?: unknown; rootId?: string; bytes?: number[]; width?: number; height?: number }): void;
  };
  currentPage: { selection: FigmaGlobalNode[] };
  viewport: { scrollAndZoomIntoView(nodes: FigmaGlobalNode[]): void };
}

declare const figma: FigmaGlobal;
declare const __html__: string;

function createFigmaFacade(): FigmaFacade {
  return {
    createFrame: () => figma.createFrame() as unknown as FigmaFacadeNode,
    createText: () => figma.createText() as unknown as FigmaFacadeNode,
    createRectangle: () => figma.createRectangle() as unknown as FigmaFacadeNode,
    createImage: (bytes) => figma.createImage(bytes),
    decodeBase64: (data) => figma.base64Decode(data),
    appendChild: (parent, child) => (parent as unknown as FigmaGlobalNode).appendChild(child as unknown as FigmaGlobalNode),
    setPluginData: (node, key, value) => (node as unknown as FigmaGlobalNode).setPluginData(key, value),
    loadFontAsync: async (family, style) => {
      await figma.loadFontAsync({ family, style });
    },
  };
}

figma.showUI(__html__, { width: 420, height: 480 });

let importedRootIds = new Set<string>();

figma.ui.onmessage = async (message) => {
  if (message.type === "export-root-png" && typeof message.rootId === "string") {
    if (!importedRootIds.has(message.rootId)) {
      figma.ui.postMessage({ type: "import-error", message: "PNG 导出失败：只能导出本次导入生成的根节点" });
      return;
    }
    const root = figma.getNodeById(message.rootId);
    if (!root) { figma.ui.postMessage({ type: "import-error", message: "PNG 导出失败：根节点不存在" }); return; }
    try {
      const bytes = await root.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: 1 } });
      figma.ui.postMessage({ type: "figma-root-png", rootId: root.id, bytes: Array.from(bytes), width: root.width, height: root.height });
    } catch (cause) { figma.ui.postMessage({ type: "import-error", message: `PNG 导出失败：${cause instanceof Error ? cause.message : "未知错误"}` }); }
    return;
  }
  if (message.type !== "import-bundle") return;
  const parsed = parseFigmaImportBundle(message.bundle);
  if (!parsed.ok) {
    figma.ui.postMessage({ type: "import-error", message: parsed.error });
    return;
  }
  try {
    const report = await importBundle(parsed.bundle, createFigmaFacade());
    const roots = report.rootIds
      .map((id) => figma.getNodeById(id))
      .filter((node): node is FigmaGlobalNode => node !== null);
    figma.currentPage.selection = roots;
    figma.viewport.scrollAndZoomIntoView(roots);
    importedRootIds = new Set(report.rootIds);
    figma.ui.postMessage({ type: "import-report", report });
  } catch (cause) {
    figma.ui.postMessage({ type: "import-error", message: cause instanceof Error ? cause.message : "导入过程发生未知错误" });
  }
};
