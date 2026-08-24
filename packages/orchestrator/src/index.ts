import {
  traceEventSchema,
  type ComponentMapping,
  type TraceEvent,
  type UISpec,
  type WorkflowState,
} from "@d2c/contracts";
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
      message: "Product grid uses a hardcoded 18px gap",
      suggestion: "Replace it with var(--spacing-lg)",
    },
    {
      id: "raw-button",
      severity: "P1",
      category: "component",
      nodeId: "header",
      message: "Cart action bypasses the SDS Button component",
      suggestion: "Reuse Button with the ghost variant",
    },
    {
      id: "grid-offset",
      severity: "P2",
      category: "geometry",
      nodeId: "grid",
      message: "Grid begins 8px above the Figma target",
      suggestion: "Use the spacing/2xl section gap token",
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
  const events: TraceEvent[] = [
    event(input.runId, 1, "VALIDATED", "Bundle validated", "4 JSON artifacts · 1 preview · schema v1.0"),
    event(input.runId, 2, "NORMALIZED", "UISpec compiled", "Auto Layout and token bindings preserved", {
      uiSpec: input.spec,
    }),
    event(input.runId, 3, "ASSETS_INDEXED", "SDS assets indexed", "5 components · 9 design tokens · 14 code examples"),
    event(input.runId, 4, "COMPONENTS_MAPPED", "Components mapped", "Evidence-backed mapping completed", {
      mappings: input.mappings,
    }),
    event(input.runId, 5, "CODE_PLANNED", "Code plan approved", "Reuse Header and ProductCard; create one page module", {
      files: ["src/pages/ProductGridPage.tsx", "src/pages/product-grid.css"],
    }),
    event(input.runId, 6, "GENERATED", "React code generated", "4 Figma instances resolved to production components", {
      generatedCode,
      diff: "+ ProductGridPage.tsx\n+ product-grid.css\n+ 4 SDS component usages",
    }),
    event(input.runId, 7, "BUILT", "Build passed", "TypeScript 0 errors · Vite build 812ms"),
    event(input.runId, 8, "EVALUATED", "Eval Agent scored iteration 1", "Three actionable violations found", {
      evaluation: firstEvaluation,
    }),
    event(input.runId, 9, "REPAIRING", "Build Agent applied targeted repair", "No page-wide regeneration", {
      patches: [
        "18px → var(--spacing-lg)",
        "<button> → <Button variant=\"ghost\">",
        "section gap → var(--spacing-2xl)",
      ],
    }),
    event(input.runId, 10, "BUILT", "Repair build passed", "Only two source files changed"),
    event(input.runId, 11, "EVALUATED", "Eval Agent scored iteration 2", "All P1/P2 violations resolved", {
      evaluation: finalEvaluation,
    }),
    event(input.runId, 12, "COMPLETED", "Delivery ready", "Code diff, evaluation and trace are ready to download", {
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
