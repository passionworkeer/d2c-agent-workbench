import { z } from "zod";

export const viewportSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
});

export const tokenBindingSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean()]),
  variable: z.string().min(1),
});

export const designNodeSchema: z.ZodType<DesignNode> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.string().min(1),
    width: z.number().nonnegative(),
    height: z.number().nonnegative(),
    layoutMode: z.enum(["NONE", "HORIZONTAL", "VERTICAL", "GRID"]),
    layoutSizingHorizontal: z.enum(["FIXED", "HUG", "FILL"]),
    layoutSizingVertical: z.enum(["FIXED", "HUG", "FILL"]),
    gap: z.union([z.number().nonnegative(), tokenBindingSchema]).optional(),
    padding: z
      .object({
        top: z.union([z.number().nonnegative(), tokenBindingSchema]),
        right: z.union([z.number().nonnegative(), tokenBindingSchema]),
        bottom: z.union([z.number().nonnegative(), tokenBindingSchema]),
        left: z.union([z.number().nonnegative(), tokenBindingSchema]),
      })
      .optional(),
    characters: z.string().optional(),
    componentId: z.string().optional(),
    componentProperties: z.record(z.string(), z.unknown()).optional(),
    boundVariables: z.record(z.string(), tokenBindingSchema).optional(),
    children: z.array(designNodeSchema),
  }),
);

export const designBundleSchema = z.object({
  manifest: z.object({
    protocolVersion: z.literal("1.0"),
    name: z.string().min(1),
    viewport: viewportSchema,
    exportedAt: z.string().datetime().optional(),
  }),
  nodes: z.array(designNodeSchema).min(1),
  variables: z.array(z.record(z.string(), z.unknown())),
  components: z.array(z.record(z.string(), z.unknown())),
  previewUrl: z.string().optional(),
});

export const sizingModeSchema = z.enum(["fixed", "hug", "fill"]);
export const directionSchema = z.enum(["row", "column", "grid", "none"]);

export const uiSpecNodeSchema: z.ZodType<UISpecNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    semanticRole: z.string().optional(),
    layout: z.object({
      direction: directionSchema,
      width: sizingModeSchema,
      height: sizingModeSchema,
      gap: z.union([z.number().nonnegative(), tokenBindingSchema]).optional(),
      padding: z
        .object({
          top: z.union([z.number().nonnegative(), tokenBindingSchema]),
          right: z.union([z.number().nonnegative(), tokenBindingSchema]),
          bottom: z.union([z.number().nonnegative(), tokenBindingSchema]),
          left: z.union([z.number().nonnegative(), tokenBindingSchema]),
        })
        .optional(),
    }),
    component: z
      .object({
        figmaComponent: z.string().optional(),
        codeComponent: z.string().optional(),
        importPath: z.string().optional(),
        props: z.record(z.string(), z.unknown()).optional(),
        confidence: z.number().min(0).max(1).optional(),
        evidence: z.array(z.string()).optional(),
      })
      .optional(),
    styles: z.record(z.string(), z.unknown()),
    content: z.string().optional(),
    children: z.array(uiSpecNodeSchema),
  }),
);

export const uiSpecSchema = z.object({
  version: z.number().int().positive(),
  name: z.string().min(1),
  viewport: viewportSchema,
  root: uiSpecNodeSchema,
});

export const componentMappingSchema = z.object({
  nodeId: z.string(),
  figmaComponent: z.string(),
  codeComponent: z.string(),
  importPath: z.string(),
  props: z.record(z.string(), z.unknown()),
  confidence: z.number().min(0).max(1),
  status: z.enum(["accepted", "review", "unmapped"]),
  evidence: z.array(z.string()),
});

export const workflowStateSchema = z.enum([
  "UPLOADED",
  "VALIDATED",
  "NORMALIZED",
  "ASSETS_INDEXED",
  "COMPONENTS_MAPPED",
  "CODE_PLANNED",
  "GENERATED",
  "BUILT",
  "EVALUATED",
  "REPAIRING",
  "COMPLETED",
  "NEEDS_REVIEW",
  "FAILED",
]);

export const traceEventSchema = z.object({
  id: z.string(),
  runId: z.string(),
  timestamp: z.string().datetime(),
  state: workflowStateSchema,
  title: z.string(),
  detail: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

export const evaluationMetricsSchema = z.object({
  geometry: z.number().min(0).max(100),
  componentReuse: z.number().min(0).max(100),
  tokenCompliance: z.number().min(0).max(100),
  visualFidelity: z.number().min(0).max(100),
  semanticStructure: z.number().min(0).max(100),
  codeQuality: z.number().min(0).max(100),
});

export const violationSchema = z.object({
  id: z.string(),
  severity: z.enum(["P0", "P1", "P2"]),
  category: z.string(),
  nodeId: z.string().optional(),
  message: z.string(),
  suggestion: z.string(),
});

export const evaluationReportSchema = z.object({
  iteration: z.number().int().positive(),
  overall: z.number().min(0).max(100),
  metrics: evaluationMetricsSchema,
  violations: z.array(violationSchema),
  resolvedViolationIds: z.array(z.string()).optional(),
});

export interface DesignNode {
  id: string;
  name: string;
  type: string;
  width: number;
  height: number;
  layoutMode: "NONE" | "HORIZONTAL" | "VERTICAL" | "GRID";
  layoutSizingHorizontal: "FIXED" | "HUG" | "FILL";
  layoutSizingVertical: "FIXED" | "HUG" | "FILL";
  gap?: number | TokenBinding;
  padding?: {
    top: number | TokenBinding;
    right: number | TokenBinding;
    bottom: number | TokenBinding;
    left: number | TokenBinding;
  };
  characters?: string;
  componentId?: string;
  componentProperties?: Record<string, unknown>;
  boundVariables?: Record<string, TokenBinding>;
  children: DesignNode[];
}

export interface TokenBinding {
  value: string | number | boolean;
  variable: string;
}

export interface UISpecNode {
  id: string;
  name: string;
  type: string;
  semanticRole?: string;
  layout: {
    direction: "row" | "column" | "grid" | "none";
    width: "fixed" | "hug" | "fill";
    height: "fixed" | "hug" | "fill";
    gap?: number | TokenBinding;
    padding?: DesignNode["padding"];
  };
  component?: {
    figmaComponent?: string;
    codeComponent?: string;
    importPath?: string;
    props?: Record<string, unknown>;
    confidence?: number;
    evidence?: string[];
  };
  styles: Record<string, unknown>;
  content?: string;
  children: UISpecNode[];
}

export type DesignBundle = z.infer<typeof designBundleSchema>;
export type UISpec = z.infer<typeof uiSpecSchema>;
export type ComponentMapping = z.infer<typeof componentMappingSchema>;
export type WorkflowState = z.infer<typeof workflowStateSchema>;
export type TraceEvent = z.infer<typeof traceEventSchema>;
export type EvaluationMetrics = z.infer<typeof evaluationMetricsSchema>;
export type EvaluationReport = z.infer<typeof evaluationReportSchema>;
