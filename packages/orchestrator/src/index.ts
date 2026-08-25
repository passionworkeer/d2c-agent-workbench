import {
  traceEventSchema,
  type ComponentMapping,
  type TokenBinding,
  type TraceEvent,
  type UISpec,
  type UISpecNode,
  type WorkflowState,
} from "@d2c/contracts";
import { SDS_REGISTRY_SIZE } from "@d2c/component-matcher";
import { compareEvaluations, createEvaluation } from "@d2c/evaluator";

export interface ReplayWorkflowInput {
  runId: string;
  spec: UISpec;
  mappings: ComponentMapping[];
  delayMs?: number;
}

const generatedCode = `import { Header } from "@/components/Header";
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

const firstEvaluation = createEvaluation(
  1,
  {
    geometry: 68,
    componentReuse: 70,
    tokenCompliance: 65,
    visualFidelity: 80,
    semanticStructure: 80,
    codeQuality: 80,
  },
  [
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
);

const finalEvaluation = createEvaluation(
  2,
  {
    geometry: 94,
    componentReuse: 95,
    tokenCompliance: 95,
    visualFidelity: 92,
    semanticStructure: 93,
    codeQuality: 94,
  },
  [],
  ["hardcoded-gap", "raw-button", "grid-offset"],
);

// 与 apps/web/src/lib/mock-run.ts 保持一致的一致性守护见 scripts/consistency.test.ts。
function collectBoundTokens(node: UISpecNode, into: Set<string>): void {
  const { gap, padding } = node.layout;
  if (gap && typeof gap === "object") into.add(gap.variable);
  if (padding) {
    for (const edge of [padding.top, padding.right, padding.bottom, padding.left]) {
      if (typeof edge === "object") into.add((edge as TokenBinding).variable);
    }
  }
  for (const value of Object.values(node.styles)) {
    if (value && typeof value === "object" && "variable" in (value as TokenBinding)) {
      into.add((value as TokenBinding).variable);
    }
  }
  for (const child of node.children) collectBoundTokens(child, into);
}

function countNodes(node: UISpecNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}

function wait(delayMs: number): Promise<void> {
  return delayMs > 0
    ? new Promise((resolve) => setTimeout(resolve, delayMs))
    : Promise.resolve();
}

function event(
  runId: string,
  index: number,
  state: WorkflowState,
  title: string,
  detail?: string,
  data?: Record<string, unknown>,
): TraceEvent {
  return traceEventSchema.parse({
    id: `${runId}-${index}`,
    runId,
    timestamp: new Date(Date.UTC(2026, 7, 24, 12, 0, index)).toISOString(),
    state,
    title,
    detail,
    data,
  });
}

export async function* runReplayWorkflow(
  input: ReplayWorkflowInput,
): AsyncGenerator<TraceEvent> {
  const delayMs = input.delayMs ?? 260;
  const comparison = compareEvaluations(firstEvaluation, finalEvaluation);
  const tokens = new Set<string>();
  collectBoundTokens(input.spec.root, tokens);
  const events: TraceEvent[] = [
    event(input.runId, 1, "VALIDATED", "资产包校验完成", "4 个 JSON 文件 · 1 个预览 · 协议 v1.0"),
    event(input.runId, 2, "NORMALIZED", "UISpec 编译完成", "已保留 Auto Layout、Sizing 与 Design Token", {
      uiSpec: input.spec,
    }),
    event(
      input.runId,
      3,
      "ASSETS_INDEXED",
      "SDS 资产索引完成",
      `${SDS_REGISTRY_SIZE} 个组件 · ${tokens.size} 个 Design Token · ${countNodes(input.spec.root)} 个 UI 节点`,
    ),
    event(input.runId, 4, "COMPONENTS_MAPPED", "生产组件匹配完成", "已生成可追溯的组件匹配证据", {
      mappings: input.mappings,
    }),
    event(input.runId, 5, "CODE_PLANNED", "代码计划已确认", "复用 Header 与 ProductCard，仅新增一个页面模块", {
      files: ["src/pages/ProductGridPage.tsx", "src/pages/product-grid.css"],
    }),
    event(
      input.runId,
      6,
      "GENERATED",
      "React 代码生成完成",
      `${input.mappings.length} 个 Figma 实例已转换为生产组件`,
      {
        generatedCode,
        diff: `+ ProductGridPage.tsx\n+ product-grid.css\n+ ${input.mappings.length} 处 SDS 组件复用`,
      },
    ),
    event(input.runId, 7, "BUILT", "项目构建通过", "TypeScript 0 个错误 · Vite 构建耗时 812ms"),
    event(
      input.runId,
      8,
      "EVALUATED",
      "Eval Agent 完成首次评测",
      `发现 ${firstEvaluation.violations.length} 个可执行修复项`,
      { evaluation: firstEvaluation },
    ),
    event(input.runId, 9, "REPAIRING", "Build Agent 执行定向修复", "仅修改问题节点，没有重新生成整个页面", {
      patches: [
        "18px → var(--spacing-lg)",
        "<button> → <Button variant=\"ghost\">",
        "区块间距 → var(--spacing-2xl)",
      ],
    }),
    event(input.runId, 10, "BUILT", "修复版本构建通过", "仅有 2 个源文件发生变更"),
    event(input.runId, 11, "EVALUATED", "Eval Agent 完成复评", "全部 P1 / P2 问题已解决", {
      evaluation: finalEvaluation,
    }),
    event(input.runId, 12, "COMPLETED", "代码交付已就绪", "代码 Diff、评测报告和执行轨迹均可下载", {
      scoreDelta: comparison.delta,
      resolvedViolationIds: comparison.resolvedViolationIds,
      generatedCode,
    }),
  ];

  for (const item of events) {
    await wait(delayMs);
    yield item;
  }
}
