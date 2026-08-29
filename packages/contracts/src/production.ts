import { z } from "zod";

const relativePathSchema = z.string().min(1).refine((value) => {
  const normalized = value.replaceAll("\\", "/");
  return !normalized.startsWith("/")
    && !/^[A-Za-z]:\//.test(normalized)
    && !normalized.split("/").includes("..");
}, "path must be relative and cannot traverse outside its root");

export const rectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
}).strict();

export const assetCropSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().positive().max(1),
  height: z.number().positive().max(1),
}).strict().superRefine((value, context) => {
  if (value.x + value.width > 1) {
    context.addIssue({ code: "custom", path: ["width"], message: "x + width must not exceed 1" });
  }
  if (value.y + value.height > 1) {
    context.addIssue({ code: "custom", path: ["height"], message: "y + height must not exceed 1" });
  }
});

export const evidenceRefSchema = z.object({
  type: z.enum(["pixel", "ocr", "prd", "asset", "repository", "user", "agent"]),
  sourceId: z.string().min(1),
  region: rectSchema.optional(),
  observation: z.string().min(1),
  confidence: z.number().min(0).max(1),
}).strict();

const sizeRuleSchema = z.object({
  mode: z.enum(["fixed", "hug", "fill", "percent", "viewport"]),
  value: z.number().nonnegative().optional(),
  unit: z.enum(["px", "%", "vw", "vh"]).optional(),
}).strict().superRefine((value, context) => {
  if (["fixed", "percent", "viewport"].includes(value.mode) && value.value === undefined) {
    context.addIssue({ code: "custom", message: `${value.mode} size requires a value` });
  }
});

const edgeValuesSchema = z.object({
  top: z.number(),
  right: z.number(),
  bottom: z.number(),
  left: z.number(),
}).strict();

export const layoutSpecSchema = z.object({
  mode: z.enum(["flow", "flex", "grid", "absolute", "sticky", "fixed"]),
  direction: z.enum(["row", "column"]).optional(),
  align: z.string().optional(),
  justify: z.string().optional(),
  gap: z.number().nonnegative().optional(),
  padding: edgeValuesSchema.optional(),
  width: sizeRuleSchema,
  height: sizeRuleSchema,
  minWidth: z.number().nonnegative().optional(),
  maxWidth: z.number().positive().optional(),
  minHeight: z.number().nonnegative().optional(),
  maxHeight: z.number().positive().optional(),
  position: z.object({ top: z.number().optional(), right: z.number().optional(), bottom: z.number().optional(), left: z.number().optional() }).strict().optional(),
  zIndex: z.number().int().optional(),
  overflow: z.enum(["visible", "hidden", "clip", "auto"]).optional(),
  rationale: z.string().min(1),
}).strict();

const paintSchema = z.object({
  type: z.enum(["solid", "gradient", "image", "none"]),
  value: z.string().optional(),
  assetId: z.string().optional(),
}).strict();

const visualSpecSchema = z.object({
  opacity: z.number().min(0).max(1).default(1),
  color: z.string().optional(),
  background: paintSchema.optional(),
  fontFamily: z.string().optional(),
  fontSize: z.number().positive().optional(),
  fontWeight: z.number().int().min(100).max(1000).optional(),
  lineHeight: z.number().positive().optional(),
  letterSpacing: z.number().optional(),
  textAlign: z.enum(["left", "center", "right", "justify"]).optional(),
  borderRadius: z.number().nonnegative().optional(),
  border: z.string().optional(),
  shadow: z.string().optional(),
  objectFit: z.enum(["contain", "cover", "fill", "none", "scale-down"]).optional(),
  objectPosition: z.string().optional(),
}).strict();

const responsiveConstraintSchema = z.object({
  viewport: z.string().min(1),
  rule: z.enum(["stack", "wrap", "hide", "show", "resize", "reposition", "preserve"]),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
}).strict();

const componentBindingSchema = z.object({
  codeComponent: z.string().min(1),
  importPath: z.string().min(1),
  props: z.record(z.string(), z.unknown()).default({}),
  confidence: z.number().min(0).max(1),
  evidence: z.array(evidenceRefSchema).default([]),
  status: z.enum(["accepted", "review", "unmapped"]),
}).strict();

export const activityNodeSchema = z.object({
  id: z.string().min(1),
  parentId: z.string().min(1).optional(),
  role: z.enum(["page", "section", "container", "text", "image", "icon", "component", "decoration"]),
  name: z.string().min(1),
  sourceBox: rectSchema,
  layout: layoutSpecSchema,
  responsive: z.array(responsiveConstraintSchema).default([]),
  visual: visualSpecSchema,
  content: z.object({
    text: z.string().optional(),
    assetId: z.string().optional(),
    alt: z.string().optional(),
  }).strict().optional(),
  component: componentBindingSchema.optional(),
  tokenRefs: z.array(z.string()).default([]),
  evidence: z.array(evidenceRefSchema).min(1),
  confidence: z.number().min(0).max(1),
  reviewState: z.enum(["accepted", "needs-review", "rejected"]),
  children: z.array(z.string()).default([]),
}).strict();

export const activitySpecSchema = z.object({
  version: z.literal("2.0"),
  page: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    route: z.string().startsWith("/"),
    canonicalViewport: z.object({ width: z.number().positive(), height: z.number().positive() }).strict(),
    background: paintSchema,
  }).strict(),
  breakpoints: z.array(z.object({
    name: z.string().min(1),
    minWidth: z.number().nonnegative(),
    maxWidth: z.number().positive().optional(),
  }).strict()).default([]),
  tokens: z.array(z.object({ name: z.string().min(1), value: z.union([z.string(), z.number()]), source: z.enum(["repository", "local", "reference"]) }).strict()).default([]),
  assets: z.array(z.object({ id: z.string().min(1), path: relativePathSchema, mimeType: z.string().min(1), hash: z.string().optional(), evidence: z.array(evidenceRefSchema).default([]) }).strict()).default([]),
  nodes: z.array(activityNodeSchema).min(1),
  interactions: z.array(z.object({ nodeId: z.string().min(1), event: z.string().min(1), action: z.string().min(1) }).strict()).default([]),
  unresolved: z.array(z.object({ id: z.string().min(1), nodeId: z.string().optional(), reason: z.string().min(1), candidates: z.array(z.string()).default([]) }).strict()).default([]),
}).strict().superRefine((value, context) => {
  const ids = new Set<string>();
  for (const [index, node] of value.nodes.entries()) {
    if (ids.has(node.id)) context.addIssue({ code: "custom", path: ["nodes", index, "id"], message: "stable node ids must be unique" });
    ids.add(node.id);
  }
});

const commandSchema = z.array(z.string().min(1)).min(1).max(16);

export const targetProjectProfileSchema = z.object({
  repositoryPath: relativePathSchema,
  framework: z.literal("react"),
  language: z.literal("typescript"),
  packageManager: z.enum(["pnpm", "npm", "yarn"]),
  routeEntry: relativePathSchema,
  generatedRoot: relativePathSchema,
  assetRoot: relativePathSchema,
  styleStrategy: z.enum(["css-modules", "tailwind", "styled-components", "plain-css"]),
  commands: z.object({ install: commandSchema.optional(), typecheck: commandSchema, build: commandSchema, dev: commandSchema }).strict(),
  previewUrl: z.string().url(),
  allowedWriteGlobs: z.array(relativePathSchema).min(1),
  designSystemRoots: z.array(relativePathSchema).default([]),
  tokenRoots: z.array(relativePathSchema).default([]),
  storybookRoots: z.array(relativePathSchema).optional(),
  codeConnectRoots: z.array(relativePathSchema).optional(),
}).strict().superRefine((value, context) => {
  const generated = value.generatedRoot.replaceAll("\\", "/");
  const allowed = value.allowedWriteGlobs.some((glob) => {
    const prefix = glob.replaceAll("\\", "/").replace(/\/\*\*.*$/, "").replace(/\*.*$/, "").replace(/\/$/, "");
    return generated === prefix || generated.startsWith(`${prefix}/`);
  });
  if (!allowed) context.addIssue({ code: "custom", path: ["generatedRoot"], message: "generatedRoot must be covered by allowedWriteGlobs" });
});

export const codePlanSchema = z.object({
  route: z.string().startsWith("/"),
  files: z.array(z.object({ path: relativePathSchema, action: z.enum(["create", "modify"]), purpose: z.string().min(1), nodeIds: z.array(z.string()).min(1) }).strict()).min(1),
  reusedComponents: z.array(componentBindingSchema).default([]),
  localComponents: z.array(z.object({ name: z.string().min(1), nodeIds: z.array(z.string()).min(1) }).strict()).default([]),
  assets: z.array(z.object({ source: relativePathSchema, target: relativePathSchema }).strict()).default([]),
  styleStrategy: z.string().min(1),
  risks: z.array(z.string()).default([]),
}).strict();

export const sourceMapSchema = z.object({
  version: z.literal("1.0"),
  locators: z.array(z.object({
    nodeId: z.string().min(1),
    file: relativePathSchema,
    componentName: z.string().optional(),
    jsxRange: z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }).strict().optional(),
    styleFile: relativePathSchema.optional(),
    styleSelector: z.string().optional(),
    assetPaths: z.array(relativePathSchema).optional(),
  }).strict()),
}).strict();

const semanticReviewIssueSchema = z.object({
  title: z.string().min(1),
  severity: z.enum(["P1", "P2", "P3"]),
  region: rectSchema.optional(),
}).strict();

export const semanticReviewEvidenceSchema = z.object({
  score: z.number().min(0).max(100),
  layout: z.number().min(0).max(100),
  content: z.number().min(0).max(100),
  visualTone: z.number().min(0).max(100),
  taskClarity: z.number().min(0).max(100),
  summary: z.string().min(1),
  issues: z.array(semanticReviewIssueSchema).max(5),
  provider: z.enum(["minimax", "registered-fallback"]),
}).strict();

/**
 * 客观评测指标。
 * 视觉与语义类指标（perceptualDiff/textConsistency/assetConsistency/semanticReview）均来自外部证据
 * （参考截图 / PRD 文本 / 资产 pHash / VLM 评分）。无证据时分数标记为 null 并通过 `*Available: false` 告知调用方：
 * 评测器会从重算权重中剔除该项，且 outcome 不能为 passed。layoutGeometry / engineering 指标始终来自真实产物，
 * 故不带 available 字段。
 */
export const productionMetricsSchema = z.object({
  visual: z.object({
    layoutGeometry: z.number().min(0).max(100),
    perceptualDiff: z.number().min(0).max(100).nullable(),
    perceptualDiffAvailable: z.boolean(),
    textConsistency: z.number().min(0).max(100).nullable(),
    textConsistencyAvailable: z.boolean(),
    colorEffects: z.number().min(0).max(100).nullable(),
    colorEffectsAvailable: z.boolean(),
    assetConsistency: z.number().min(0).max(100).nullable(),
    assetConsistencyAvailable: z.boolean(),
    semanticReview: z.number().min(0).max(100).nullable(),
    semanticReviewAvailable: z.boolean(),
  }).strict(),
  engineering: z.object({ buildSuccess: z.number().min(0).max(100), componentReuse: z.number().min(0).max(100), tokenUsage: z.number().min(0).max(100), structuralAbsoluteRatio: z.number().min(0).max(100), hardcodeRatio: z.number().min(0).max(100), responsiveBehavior: z.number().min(0).max(100), semanticHtml: z.number().min(0).max(100), accessibility: z.number().min(0).max(100), codeComplexity: z.number().min(0).max(100) }).strict(),
  visualScore: z.number().min(0).max(100),
  engineeringScore: z.number().min(0).max(100),
  finalScore: z.number().min(0).max(100),
}).strict();

export const productionViolationSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(["P0", "P1", "P2", "P3"]),
  type: z.enum(["build", "layout", "style", "asset", "text", "component", "responsive"]),
  region: rectSchema.optional(),
  nodeIds: z.array(z.string()).default([]),
  sourceLocators: sourceMapSchema.shape.locators,
  expected: z.unknown(),
  actual: z.unknown(),
  evidence: z.array(evidenceRefSchema).default([]),
  confidence: z.number().min(0).max(1),
  suggestedAction: z.string().optional(),
}).strict();

const patchOperationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("spec"), nodeId: z.string(), path: z.string(), value: z.unknown() }).strict(),
  z.object({ kind: z.literal("tsx"), file: relativePathSchema, nodeId: z.string(), attribute: z.string(), value: z.unknown() }).strict(),
  z.object({ kind: z.literal("css"), file: relativePathSchema, selector: z.string(), property: z.string(), value: z.string() }).strict(),
  z.object({ kind: z.literal("asset"), file: relativePathSchema, source: relativePathSchema }).strict(),
]);

export const patchPlanSchema = z.object({
  round: z.number().int().min(1).max(3),
  targetViolationIds: z.array(z.string()).min(1),
  expectedImprovement: z.string().min(1),
  operations: z.array(patchOperationSchema).min(1),
  allowedFiles: z.array(relativePathSchema).min(1).max(5),
  rollbackArtifact: z.string().min(1),
}).strict();

/** ActivitySpec 域的编辑操作（Puck 原型 / 工作台编辑面板发出，服务端 /edit 消费） */
export const specEditOpSchema = z.object({
  kind: z.literal("set-content"),
  nodeId: z.string().min(1),
  text: z.string(),
}).strict();

export const specEditOpsSchema = z.array(specEditOpSchema);

export const productionRunSchema = z.object({
  id: z.string().min(1),
  mode: z.literal("production"),
  state: z.enum(["CREATED", "INPUT_VALIDATED", "PROJECT_INSPECTED", "VISUAL_DRAFTED", "SPEC_VALIDATED", "MAPPINGS_RESOLVED", "PREPARING", "CODE_PLANNED", "GENERATED", "TYPECHECKED", "BUILT", "RENDERED", "EVALUATED", "ATTRIBUTED", "REPAIR_PLANNED", "REPAIR_APPLIED", "COMPLETED", "NEEDS_REVIEW", "FAILED"]),
  status: z.enum(["running", "completed", "needs_review", "failed"]),
  createdAt: z.string().datetime(),
  iteration: z.number().int().min(0).max(3),
  artifacts: z.array(z.object({ id: z.string(), kind: z.string(), path: relativePathSchema, createdAt: z.string().datetime() }).strict()).default([]),
  metrics: productionMetricsSchema.optional(),
  violations: z.array(productionViolationSchema).default([]),
}).strict();

export type Rect = z.infer<typeof rectSchema>;
export type AssetCrop = z.infer<typeof assetCropSchema>;
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;
export type ActivityNode = z.infer<typeof activityNodeSchema>;
export type ActivitySpec = z.infer<typeof activitySpecSchema>;
export type TargetProjectProfile = z.infer<typeof targetProjectProfileSchema>;
export type CodePlan = z.infer<typeof codePlanSchema>;
export type D2CSourceMap = z.infer<typeof sourceMapSchema>;
export type SemanticReviewEvidence = z.infer<typeof semanticReviewEvidenceSchema>;
export type ProductionMetrics = z.infer<typeof productionMetricsSchema>;
export type ProductionViolation = z.infer<typeof productionViolationSchema>;
export type PatchPlan = z.infer<typeof patchPlanSchema>;
export type SpecEditOp = z.infer<typeof specEditOpSchema>;
export type ProductionRun = z.infer<typeof productionRunSchema>;
