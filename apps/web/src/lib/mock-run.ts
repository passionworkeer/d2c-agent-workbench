import type {
  ComponentMapping,
  EvaluationReport,
  TraceEvent,
  UISpec,
  UISpecNode,
  WorkflowState,
} from "@d2c/contracts";
import type { RunDetail } from "./api";

const mockRunId = "mock-product-grid";

const previewSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500"><rect width="800" height="500" fill="#f4f1e8"/><rect x="24" y="24" width="752" height="56" rx="10" fill="#171a16"/><text x="48" y="60" fill="#fff" font-family="Arial" font-weight="700" font-size="18">KINETIC®</text><text x="24" y="130" fill="#f05a2a" font-family="Arial" font-size="12">全新系列 / 26FW</text><text x="24" y="170" fill="#171a16" font-family="Arial" font-weight="700" font-size="34">为运动而生的设计。</text><rect x="24" y="205" width="176" height="250" rx="12" fill="#3154e8"/><rect x="216" y="205" width="176" height="250" rx="12" fill="#f05a2a"/><rect x="408" y="205" width="176" height="250" rx="12" fill="#b8e636"/><rect x="600" y="205" width="176" height="250" rx="12" fill="#292927"/><circle cx="112" cy="315" r="42" fill="#f4f1e8"/><rect x="282" y="270" width="44" height="88" rx="22" fill="#171a16"/><path d="M496 270l48 88h-96z" fill="#171a16"/><ellipse cx="688" cy="315" rx="49" ry="25" fill="none" stroke="#f4f1e8" stroke-width="18" transform="rotate(-15 688 315)"/><g fill="#fff" font-family="Arial" font-size="12" font-weight="700"><text x="38" y="420">弧线跑鞋 01</text><text x="230" y="420">形态手袋 02</text><text x="614" y="420">虚空帽 04</text></g><text x="422" y="420" fill="#171a16" font-family="Arial" font-size="12" font-weight="700">机能外套 03</text></svg>`;

const previewUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(previewSvg)}`;

// mock uiSpec 必须与 examples/figma-bundles/product-grid 通过 orchestrator 跑出来的真实结构 1:1 对齐：
// - 10 个 UI 节点（1 page + 1 header + 1 intro + 2 intro 子节点 + 1 grid + 4 card）。
// - 10 个 Design Token（5 spacing + 5 color/typography）；collectBoundTokens 集合去重后正好 = 10。
// - 5 个 SDS 组件实例（1 Header + 4 ProductCard），nodeId 与 mockMappings 一致。
// 一致性由 scripts/consistency.test.ts 守护。
const cards = [
  { id: "card-1", tone: "cobalt", badge: "New" },
  { id: "card-2", tone: "coral", badge: "Limited" },
  { id: "card-3", tone: "lime", badge: "Core" },
  { id: "card-4", tone: "charcoal", badge: "Archive" },
];

const cardNodes: UISpecNode[] = cards.map((card) => ({
  id: card.id,
  name: "Product Card / Default",
  type: "INSTANCE",
  semanticRole: "product-card",
  layout: {
    direction: "column",
    width: "fill",
    height: "hug",
    gap: { value: 16, variable: "spacing/lg" },
  },
  component: {
    figmaComponent: "Product Card / Default",
    codeComponent: "ProductCard",
    importPath: "@/components/ProductCard",
    props: { tone: card.tone, badge: card.badge },
  },
  styles: {},
  children: [],
}));

const uiSpec: UISpec = {
  version: 1,
  name: "动感商品网格",
  viewport: { width: 1440, height: 900 },
  root: {
    id: "page",
    name: "电商 / 商品网格",
    type: "FRAME",
    semanticRole: "page",
    layout: {
      direction: "column",
      width: "fixed",
      height: "fixed",
      gap: { value: 48, variable: "spacing/2xl" },
      padding: {
        top: { value: 32, variable: "spacing/xl" },
        right: { value: 56, variable: "spacing/3xl" },
        bottom: { value: 48, variable: "spacing/2xl" },
        left: { value: 56, variable: "spacing/3xl" },
      },
    },
    styles: {
      fills: { value: "#f3f1ea", variable: "color/canvas" },
    },
    children: [
      {
        id: "header",
        name: "Header / Commerce",
        type: "INSTANCE",
        semanticRole: "header",
        layout: { direction: "row", width: "fill", height: "fixed" },
        component: {
          figmaComponent: "Header / Commerce",
          codeComponent: "Header",
          importPath: "@/components/Header",
          props: { theme: "light" },
        },
        styles: {},
        children: [],
      },
      {
        id: "intro",
        name: "区块标题",
        type: "FRAME",
        semanticRole: "section-intro",
        layout: {
          direction: "column",
          width: "fill",
          height: "hug",
          gap: { value: 12, variable: "spacing/md" },
        },
        styles: {},
        children: [
          {
            id: "eyebrow",
            name: "副标题",
            type: "TEXT",
            semanticRole: "label",
            layout: { direction: "none", width: "hug", height: "hug" },
            styles: {
              fontSize: { value: 12, variable: "typography/label/font-size" },
              fills: { value: "#ef5b2a", variable: "color/accent" },
            },
            content: "全新系列 / 26FW",
            children: [],
          },
          {
            id: "title",
            name: "主标题",
            type: "TEXT",
            semanticRole: "heading",
            layout: { direction: "none", width: "hug", height: "hug" },
            styles: {
              fontSize: { value: 64, variable: "typography/display/font-size" },
              fills: { value: "#171713", variable: "color/ink" },
            },
            content: "为运动而生的设计。",
            children: [],
          },
        ],
      },
      {
        id: "grid",
        name: "四列商品网格",
        type: "FRAME",
        semanticRole: "product-grid",
        layout: {
          direction: "grid",
          width: "fill",
          height: "hug",
          gap: { value: 20, variable: "spacing/lg" },
        },
        styles: {},
        children: cardNodes,
      },
    ],
  },
};

export const mockMappings: ComponentMapping[] = [
  {
    nodeId: "header",
    figmaComponent: "Header / Commerce",
    codeComponent: "Header",
    importPath: "@/components/Header",
    props: { theme: "light" },
    confidence: 0.96,
    status: "accepted",
    evidence: [
      "Figma 组件名称精确匹配",
      "Props 1 项按原样透传，未做兼容性校验",
      "导入路径来自固定 SDS Registry",
    ],
  },
  ...cards.map<ComponentMapping>((card) => ({
    nodeId: card.id,
    figmaComponent: "Product Card / Default",
    codeComponent: "ProductCard",
    importPath: "@/components/ProductCard",
    props: { tone: card.tone, badge: card.badge },
    confidence: 0.96,
    status: "accepted",
    evidence: [
      "Figma 组件名称精确匹配",
      "Props 2 项按原样透传，未做兼容性校验",
      "导入路径来自固定 SDS Registry",
    ],
  })),
];

const firstEvaluation: EvaluationReport = {
  iteration: 1,
  overall: 72,
  metrics: {
    geometry: 68,
    componentReuse: 70,
    tokenCompliance: 65,
    visualFidelity: 80,
    semanticStructure: 80,
    codeQuality: 80,
  },
  violations: [
    {
      id: "hardcoded-gap",
      severity: "P1",
      category: "token",
      nodeId: "grid",
      message: "商品网格使用了硬编码间距 18px",
      suggestion: "替换为 var(--spacing-lg)",
    },
    {
      id: "raw-button",
      severity: "P1",
      category: "component",
      nodeId: "header",
      message: "购物车操作未复用 SDS Button",
      suggestion: "使用 Button 的 ghost 变体",
    },
    {
      id: "grid-offset",
      severity: "P2",
      category: "geometry",
      nodeId: "grid",
      message: "商品网格比 Figma 目标上移 8px",
      suggestion: "使用 spacing/2xl 区块间距",
    },
  ],
};

const finalEvaluation: EvaluationReport = {
  iteration: 2,
  overall: 94,
  metrics: {
    geometry: 94,
    componentReuse: 95,
    tokenCompliance: 95,
    visualFidelity: 92,
    semanticStructure: 93,
    codeQuality: 94,
  },
  violations: [],
  resolvedViolationIds: ["hardcoded-gap", "raw-button", "grid-offset"],
};

export const mockGeneratedCode = `import { Header } from "@/components/Header";
import { ProductCard } from "@/components/ProductCard";

export function ProductGridPage() {
  return (
    <main className="page-shell">
      <Header theme="light" />
      <section className="product-grid">
        <ProductCard tone="cobalt" badge="New" />
        <ProductCard tone="coral" badge="Limited" />
        <ProductCard tone="lime" badge="Core" />
        <ProductCard tone="charcoal" badge="Archive" />
      </section>
    </main>
  );
}`;

function collectTokens(node: UISpecNode, into: Set<string>): void {
  const layout = node.layout;
  if (layout.gap && typeof layout.gap === "object") into.add(layout.gap.variable);
  if (layout.padding) {
    for (const edge of [layout.padding.top, layout.padding.right, layout.padding.bottom, layout.padding.left]) {
      if (typeof edge === "object") into.add(edge.variable);
    }
  }
  for (const value of Object.values(node.styles)) {
    if (value && typeof value === "object" && "variable" in value) {
      into.add((value as { variable: string }).variable);
    }
  }
  for (const child of node.children) collectTokens(child, into);
}

function countNodes(node: UISpecNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}

function event(
  index: number,
  state: WorkflowState,
  title: string,
  detail: string,
  data?: Record<string, unknown>,
): TraceEvent {
  return {
    id: `${mockRunId}-${index}`,
    runId: mockRunId,
    timestamp: new Date(Date.UTC(2026, 7, 25, 1, 0, index)).toISOString(),
    state,
    title,
    detail,
    data,
  };
}

export function createMockEvents(): TraceEvent[] {
  const tokens = new Set<string>();
  collectTokens(uiSpec.root, tokens);
  const nodes = countNodes(uiSpec.root);
  const componentInstances = mockMappings.length;
  return [
    event(1, "VALIDATED", "资产包校验完成", "4 个 JSON 文件 · 1 个预览 · 协议 v1.0"),
    event(2, "NORMALIZED", "UISpec 编译完成", "已保留 Auto Layout、Sizing 与 Design Token", { uiSpec }),
    event(
      3,
      "ASSETS_INDEXED",
      "SDS 资产索引完成",
      `5 个组件 · ${tokens.size} 个 Design Token · ${nodes} 个 UI 节点`,
    ),
    event(4, "COMPONENTS_MAPPED", "生产组件匹配完成", "已生成可追溯的组件匹配证据", { mappings: mockMappings }),
    event(5, "CODE_PLANNED", "代码计划已确认", "复用 Header 与 ProductCard，仅新增一个页面模块", {
      files: ["src/pages/ProductGridPage.tsx", "src/pages/product-grid.css"],
    }),
    event(
      6,
      "GENERATED",
      "React 代码生成完成",
      `${componentInstances} 个 Figma 实例已转换为生产组件`,
      {
        generatedCode: mockGeneratedCode,
        diff: `+ ProductGridPage.tsx\n+ product-grid.css\n+ ${componentInstances} 处 SDS 组件复用`,
      },
    ),
    event(7, "BUILT", "项目构建通过", "TypeScript 0 个错误 · Vite 构建耗时 812ms"),
    event(8, "EVALUATED", "Eval Agent 完成首次评测", `发现 ${firstEvaluation.violations.length} 个可执行修复项`, {
      evaluation: firstEvaluation,
    }),
    event(9, "REPAIRING", "Build Agent 执行定向修复", "仅修改问题节点，没有重新生成整个页面", {
      patches: ["18px → var(--spacing-lg)", "<button> → <Button variant=\"ghost\">", "区块间距 → var(--spacing-2xl)"],
    }),
    event(10, "BUILT", "修复版本构建通过", "仅有 2 个源文件发生变更"),
    event(11, "EVALUATED", "Eval Agent 完成复评", "全部 P1 / P2 问题已解决", { evaluation: finalEvaluation }),
    event(12, "COMPLETED", "代码交付已就绪", "代码 Diff、评测报告和执行轨迹均可下载", {
      scoreDelta: 22,
      resolvedViolationIds: finalEvaluation.resolvedViolationIds,
      generatedCode: mockGeneratedCode,
    }),
  ];
}

export function createMockRun(): RunDetail {
  return {
    id: mockRunId,
    status: "running",
    state: "UPLOADED",
    previewUrl,
    uiSpec,
    mappings: [],
    events: [],
    evaluations: [],
  };
}

export function playMockWorkflow(
  onEvent: (event: TraceEvent) => void,
  options: { delayMs?: number } = {},
): { cancel: () => void; done: Promise<void> } {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolveWait: (() => void) | undefined;
  const delayMs = options.delayMs ?? 220;

  const done = (async () => {
    for (const item of createMockEvents()) {
      await new Promise<void>((resolve) => {
        resolveWait = resolve;
        timer = setTimeout(resolve, delayMs);
      });
      if (cancelled) return;
      onEvent(item);
    }
  })();

  return {
    cancel: () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      resolveWait?.();
    },
    done,
  };
}
