import type {
  ComponentMapping,
  EvaluationReport,
  TraceEvent,
  UISpec,
  WorkflowState,
} from "@d2c/contracts";
import type { RunDetail } from "./api";

const mockRunId = "mock-product-grid";

const previewSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500"><rect width="800" height="500" fill="#f4f1e8"/><rect x="24" y="24" width="752" height="56" rx="10" fill="#171a16"/><text x="48" y="60" fill="#fff" font-family="Arial" font-weight="700" font-size="18">KINETIC®</text><text x="24" y="130" fill="#f05a2a" font-family="Arial" font-size="12">全新系列 / 26FW</text><text x="24" y="170" fill="#171a16" font-family="Arial" font-weight="700" font-size="34">为运动而生的设计。</text><rect x="24" y="205" width="176" height="250" rx="12" fill="#3154e8"/><rect x="216" y="205" width="176" height="250" rx="12" fill="#f05a2a"/><rect x="408" y="205" width="176" height="250" rx="12" fill="#b8e636"/><rect x="600" y="205" width="176" height="250" rx="12" fill="#292927"/><circle cx="112" cy="315" r="42" fill="#f4f1e8"/><rect x="282" y="270" width="44" height="88" rx="22" fill="#171a16"/><path d="M496 270l48 88h-96z" fill="#171a16"/><ellipse cx="688" cy="315" rx="49" ry="25" fill="none" stroke="#f4f1e8" stroke-width="18" transform="rotate(-15 688 315)"/><g fill="#fff" font-family="Arial" font-size="12" font-weight="700"><text x="38" y="420">弧线跑鞋 01</text><text x="230" y="420">形态手袋 02</text><text x="614" y="420">虚空帽 04</text></g><text x="422" y="420" fill="#171a16" font-family="Arial" font-size="12" font-weight="700">机能外套 03</text></svg>`;

const previewUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(previewSvg)}`;

const uiSpec: UISpec = {
  version: 1,
  name: "动感商品网格",
  viewport: { width: 1440, height: 900 },
  root: {
    id: "root",
    name: "电商商品网格",
    type: "FRAME",
    semanticRole: "page",
    layout: { direction: "column", width: "fixed", height: "fixed" },
    styles: { background: "color/surface/default" },
    children: [
      {
        id: "header",
        name: "电商页头",
        type: "INSTANCE",
        semanticRole: "header",
        layout: { direction: "row", width: "fill", height: "hug" },
        styles: {},
        children: [],
      },
      {
        id: "grid",
        name: "四列商品网格",
        type: "FRAME",
        semanticRole: "product-list",
        layout: {
          direction: "grid",
          width: "fill",
          height: "hug",
          gap: { value: 24, variable: "spacing/lg" },
        },
        styles: {},
        children: [],
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
    evidence: ["Figma 组件名称完全匹配", "Props 与 light 变体兼容"],
  },
  ...["cobalt", "coral", "lime", "charcoal"].map(
    (tone, index): ComponentMapping => ({
      nodeId: `product-card-${index + 1}`,
      figmaComponent: "Product Card / Default",
      codeComponent: "ProductCard",
      importPath: "@/components/ProductCard",
      props: { tone },
      confidence: 0.94,
      status: "accepted",
      evidence: ["Figma 组件名称完全匹配", "历史页面存在相同调用方式"],
    }),
  ),
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
        {products.map((product) => (
          <ProductCard key={product.id} {...product} />
        ))}
      </section>
    </main>
  );
}`;

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
  return [
    event(1, "VALIDATED", "资产包校验完成", "4 个 JSON 文件 · 1 个预览 · 协议 v1.0"),
    event(2, "NORMALIZED", "UISpec 编译完成", "已保留 Auto Layout、Sizing 与 Design Token", { uiSpec }),
    event(3, "ASSETS_INDEXED", "SDS 资产索引完成", "5 个组件 · 9 个 Design Token · 14 个代码示例"),
    event(4, "COMPONENTS_MAPPED", "生产组件匹配完成", "已生成可追溯的组件匹配证据", { mappings: mockMappings }),
    event(5, "CODE_PLANNED", "代码计划已确认", "复用 Header 与 ProductCard，仅新增一个页面模块", {
      files: ["src/pages/ProductGridPage.tsx", "src/pages/product-grid.css"],
    }),
    event(6, "GENERATED", "React 代码生成完成", "4 个 Figma 实例已转换为生产组件", {
      generatedCode: mockGeneratedCode,
      diff: "+ ProductGridPage.tsx\n+ product-grid.css\n+ 4 处 SDS 组件复用",
    }),
    event(7, "BUILT", "项目构建通过", "TypeScript 0 个错误 · Vite 构建耗时 812ms"),
    event(8, "EVALUATED", "Eval Agent 完成首次评测", "发现 3 个可执行修复项", { evaluation: firstEvaluation }),
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
