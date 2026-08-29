import { z } from "zod";

export * from "./production";

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

// Design Token 声明：来自 variables.json，ui-compiler 编译时透传到 UISpec。
// codegen 据此判断"已声明 vs 未声明"（未声明的 token 触发 define-token 修复操作）。
export const tokenDefinitionSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["COLOR", "FLOAT", "STRING"]),
  value: z.union([z.string(), z.number()]),
});
export type TokenDefinition = z.infer<typeof tokenDefinitionSchema>;

export const designBundleSchema = z.object({
  manifest: z.object({
    protocolVersion: z.literal("1.0"),
    name: z.string().min(1),
    viewport: viewportSchema,
    exportedAt: z.string().datetime().optional(),
  }),
  nodes: z.array(designNodeSchema).min(1),
  // Design Token 声明表来自 variables.json。codegen 据此区分"已声明 vs 未声明"。
  variables: z.array(tokenDefinitionSchema).default([]),
  // SDS 组件元数据来自 components.json（id/name/properties）。
  components: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        properties: z.record(z.string(), z.array(z.string())).default({}),
      }),
    )
    .default([]),
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
  // 已声明的 Design Token 表（来自 variables.json），透传给 codegen 决策是否 emit var()。
  // 老 fixture 兼容：缺省视为空数组。
  tokens: z.array(tokenDefinitionSchema).default([]),
  root: uiSpecNodeSchema,
});

// Agent 工具调用记录：串联 BUILD→EVAL→REPAIR 三类工具的输入/输出/来源（local tool / LLM）。
// result 只放轻量摘要（计数、id 等），防止 SSE 载荷膨胀。
export const toolCallSchema = z.object({
  name: z.string().min(1),
  provider: z.enum(["local", "llm"]).default("local"),
  args: z.record(z.string(), z.unknown()).optional(),
  result: z.record(z.string(), z.unknown()).optional(),
  note: z.string().optional(),
});
export const toolCallListSchema = z.array(toolCallSchema);
export type ToolCall = z.infer<typeof toolCallSchema>;
export type ToolCallList = z.infer<typeof toolCallListSchema>;

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
  // D2C（设计稿 → 代码）链路状态
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
  // I2D（参考图 / Figma → 设计稿）链路状态
  "IMAGE_RECEIVED",
  "NODETREE_PARSED",
  "VISION_PARSED",
  "LAYOUT_INFERRED",
  "COMPONENTS_DETECTED",
  "TOKENS_BOUND",
  "SPEC_GENERATED",
  "CANVAS_EDITED",
  "SPEC_EXPORTED",
  // 生产（ActivitySpec → 真实代码 → 构建渲染评测修复）链路状态，与 productionRunSchema 对齐
  "CREATED",
  "INPUT_VALIDATED",
  "PROJECT_INSPECTED",
  "VISUAL_DRAFTED",
  "SPEC_VALIDATED",
  "MAPPINGS_RESOLVED",
  "PREPARING",
  "TYPECHECKED",
  "RENDERED",
  "ATTRIBUTED",
  "REPAIR_PLANNED",
  "REPAIR_APPLIED",
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
