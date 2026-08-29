import { readFile as readFsFile } from "node:fs/promises";
import { Project, SyntaxKind } from "ts-morph";
import {
  patchPlanSchema,
  type D2CSourceMap,
  type PatchPlan,
  type ProductionViolation,
  type Rect,
  type TargetProjectProfile,
} from "@d2c/contracts";
import type { FileArtifactStore } from "./artifacts";
import { matchesWriteGlob, type RunWorkspace } from "./workspace";

type PatchOperation = PatchPlan["operations"][number];
type CssPatchOperation = Extract<PatchOperation, { kind: "css" }>;

const normalize = (value: string) => value.replaceAll("\\", "/").replace(/^\.\//, "");

const isRect = (value: unknown): value is Rect =>
  typeof value === "object" && value !== null
  && typeof (value as Rect).x === "number" && typeof (value as Rect).y === "number"
  && typeof (value as Rect).width === "number" && typeof (value as Rect).height === "number";

export function validatePatchPlan(input: unknown, profile: TargetProjectProfile, _sourceMap: D2CSourceMap): PatchPlan {
  const raw = input as { allowedFiles?: unknown };
  if (Array.isArray(raw.allowedFiles) && raw.allowedFiles.length > 5) {
    throw new Error("allowedFiles must declare at most 5 files");
  }
  const plan = patchPlanSchema.parse(input);
  for (const file of plan.allowedFiles) {
    if (!profile.allowedWriteGlobs.some((glob) => matchesWriteGlob(file, glob))) {
      throw new Error(`allowedFiles entry is outside allowedWriteGlobs: ${file}`);
    }
  }
  const declared = new Set(plan.allowedFiles.map(normalize));
  for (const operation of plan.operations) {
    if (operation.kind === "spec") continue;
    if (!declared.has(normalize(operation.file))) {
      throw new Error(`patch operation touches a file that is not declared in allowedFiles: ${operation.file}`);
    }
  }
  return plan;
}

export interface RepairPlanningInput {
  violations: ProductionViolation[];
  sourceMap: D2CSourceMap;
  round: number;
  rollbackArtifact: string;
  readFile: (path: string) => string | Promise<string>;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findRuleBlock(source: string, selector: string): [number, number] | undefined {
  const target = selector.trim();
  let cursor = 0;
  while (cursor < source.length) {
    const open = source.indexOf("{", cursor);
    if (open === -1) return undefined;
    const header = source.slice(cursor, open).split("}").at(-1) ?? "";
    const parts = header.split(",").map((part) => part.trim()).filter(Boolean);
    let depth = 1;
    let index = open + 1;
    while (index < source.length && depth > 0) {
      const character = source[index];
      if (character === "{") depth += 1;
      else if (character === "}") depth -= 1;
      index += 1;
    }
    if (parts.includes(target)) return [open, index - 1];
    cursor = index;
  }
  return undefined;
}

export function patchCssDeclaration(source: string, selector: string, property: string, value: string): string {
  const range = findRuleBlock(source, selector);
  if (!range) throw new Error(`css selector not found: ${selector}`);
  const [open, close] = range;
  const block = source.slice(open + 1, close);
  const declaration = `${property}: ${value};`;
  const existing = block.match(new RegExp(`(^|\\n)(\\s*)${escapeRegExp(property)}\\s*:[^;]*;?`));
  if (existing?.index !== undefined) {
    const replaced = block.slice(0, existing.index)
      + `${existing[1] ?? ""}${existing[2] ?? ""}${declaration}`
      + block.slice(existing.index + existing[0].length);
    return source.slice(0, open + 1) + replaced + source.slice(close);
  }
  const indent = block.match(/\n(\s*)\S/)?.[1] ?? "  ";
  if (!block.trim()) return source.slice(0, open + 1) + `\n${indent}${declaration}\n` + source.slice(close);
  return source.slice(0, open + 1) + block.replace(/\s*$/, `\n${indent}${declaration}\n`) + source.slice(close);
}

export function patchTsxAttribute(source: string, nodeId: string, attribute: string, value: unknown): string {
  const project = new Project({ useInMemoryFileSystem: true, skipFileDependencyResolution: true });
  const file = project.createSourceFile("patch.tsx", source, { overwrite: true });
  const elements = [
    ...file.getDescendantsOfKind(SyntaxKind.JsxElement).map((element) => element.getOpeningElement()),
    ...file.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ];
  const target = elements.find((element) => element.getAttribute("data-d2c-node-id")?.getText().includes(`"${nodeId}"`));
  if (!target) throw new Error(`tsx node not found: ${nodeId}`);
  const attributeText = typeof value === "string" ? `${attribute}="${value}"` : `${attribute}={${JSON.stringify(value)}}`;
  const existing = target.getAttribute(attribute);
  if (existing) existing.replaceWithText(attributeText);
  else {
    target.addAttribute({ name: attribute });
    target.getAttribute(attribute)?.replaceWithText(attributeText);
  }
  return file.getFullText();
}

export function patchSpecJson(source: string, nodeId: string, path: string, value: unknown): string {
  const spec = JSON.parse(source) as { nodes?: Array<{ id?: string }> };
  const node = spec.nodes?.find((entry) => entry.id === nodeId);
  if (!node) throw new Error(`spec node not found: ${nodeId}`);
  const segments = path.split(".");
  let container = node as Record<string, unknown>;
  for (const segment of segments.slice(0, -1)) {
    const next = container[segment];
    if (typeof next !== "object" || next === null) throw new Error(`spec path segment is not an object: ${path}`);
    container = next as Record<string, unknown>;
  }
  container[segments.at(-1) ?? ""] = value;
  return `${JSON.stringify(spec, null, 2)}\n`;
}

function currentCssValue(css: string, selector: string, property: string): number {
  const range = findRuleBlock(css, selector);
  if (!range) return 0;
  const block = css.slice(range[0] + 1, range[1]);
  const match = block.match(new RegExp(`${escapeRegExp(property)}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)px`));
  return match?.[1] ? Number(match[1]) : 0;
}

export async function planTargetedRepair(input: RepairPlanningInput): Promise<PatchPlan> {
  const cssCache = new Map<string, string>();
  const cssFor = async (path: string) => {
    const cached = cssCache.get(path);
    if (cached !== undefined) return cached;
    const source = await input.readFile(path);
    cssCache.set(path, source);
    return source;
  };
  const operations: CssPatchOperation[] = [];
  const targetViolationIds: string[] = [];
  for (const violation of input.violations) {
    if (violation.type !== "layout") continue;
    const expected = violation.expected;
    const actual = violation.actual;
    if (!isRect(expected) || !isRect(actual)) continue;
    const before = operations.length;
    for (const nodeId of violation.nodeIds) {
      const locator = input.sourceMap.locators.find((entry) => entry.nodeId === nodeId);
      if (!locator?.styleFile || !locator.styleSelector) continue;
      const css = await cssFor(locator.styleFile);
      const dx = expected.x - actual.x;
      const dy = expected.y - actual.y;
      if (Math.abs(dx) >= 1) {
        operations.push({ kind: "css", file: locator.styleFile, selector: locator.styleSelector, property: "margin-left", value: `${currentCssValue(css, locator.styleSelector, "margin-left") + dx}px` });
      }
      if (Math.abs(dy) >= 1) {
        operations.push({ kind: "css", file: locator.styleFile, selector: locator.styleSelector, property: "margin-top", value: `${currentCssValue(css, locator.styleSelector, "margin-top") + dy}px` });
      }
      if (Math.abs(expected.width - actual.width) >= 8) {
        operations.push({ kind: "css", file: locator.styleFile, selector: locator.styleSelector, property: "width", value: `${expected.width}px` });
      }
      if (Math.abs(expected.height - actual.height) >= 8) {
        operations.push({ kind: "css", file: locator.styleFile, selector: locator.styleSelector, property: "height", value: `${expected.height}px` });
      }
    }
    if (operations.length > before) targetViolationIds.push(violation.id);
  }
  if (!operations.length) throw new Error("no repairable violations with style locators found");
  const allowedFiles = [...new Set(operations.map((operation) => operation.file))].slice(0, 5);
  const bounded = operations.filter((operation) => allowedFiles.includes(operation.file));
  return patchPlanSchema.parse({
    round: input.round,
    targetViolationIds,
    expectedImprovement: `修正 ${targetViolationIds.join("、")} 的布局偏移，仅触碰 ${allowedFiles.length} 个文件`,
    operations: bounded,
    allowedFiles,
    rollbackArtifact: input.rollbackArtifact,
  });
}

export interface ApplyPatchOptions {
  /** spec 操作作用于 ActivitySpec 单一事实源，由调用方给出其在工作区内的路径 */
  specPath?: string;
}

export async function applyPatchPlan(plan: PatchPlan, workspace: RunWorkspace, store?: FileArtifactStore, options: ApplyPatchOptions = {}): Promise<string[]> {
  const specPath = options.specPath;
  if (plan.operations.some((operation) => operation.kind === "spec") && !specPath) {
    throw new Error("specPath option is required for spec operations");
  }
  const touched = [...new Set(plan.operations.flatMap((operation) => operation.kind === "spec" ? [specPath ?? ""] : [operation.file]))];
  let rollbackArtifactAbsolutePath: string | undefined;
  if (store) {
    const contents: Record<string, string> = {};
    for (const file of touched) contents[file] = Buffer.from(await workspace.readFile(file), "utf8").toString("base64");
    const record = await store.writeJson("rollback", `round-${plan.round}`, { files: contents });
    rollbackArtifactAbsolutePath = record.absolutePath;
  }
  const written: string[] = [];
  for (const operation of plan.operations) {
    if (operation.kind === "css") {
      written.push(await workspace.writeFile(operation.file, patchCssDeclaration(await workspace.readFile(operation.file), operation.selector, operation.property, operation.value)));
    } else if (operation.kind === "tsx") {
      written.push(await workspace.writeFile(operation.file, patchTsxAttribute(await workspace.readFile(operation.file), operation.nodeId, operation.attribute, operation.value)));
    } else if (operation.kind === "spec") {
      written.push(await workspace.writeFile(specPath ?? "", patchSpecJson(await workspace.readFile(specPath ?? ""), operation.nodeId, operation.path, operation.value)));
    } else {
      written.push(...await workspace.apply({ files: {}, assets: [{ source: operation.source, target: operation.file }] }));
    }
  }
  // 末位追加 rollback 文件绝对路径（约定：调用方按返回长度判断是否拿到）；空数组会让恢复路径变成 undefined
  if (rollbackArtifactAbsolutePath) written.push(rollbackArtifactAbsolutePath);
  return written;
}

export interface RollbackSnapshot {
  files: Record<string, string>;
}

export async function restoreRollback(rollbackPath: string, workspace: RunWorkspace): Promise<void> {
  const snapshot = JSON.parse(await readFsFile(rollbackPath, "utf8")) as RollbackSnapshot;
  for (const [file, encoded] of Object.entries(snapshot.files)) {
    await workspace.writeFile(file, Buffer.from(encoded, "base64"));
  }
}

/** 最多 maxRounds 轮修复；连续两轮提升不足 1 分即停止，避免无收益循环。 */
export function shouldContinueRepair(scores: number[], maxRounds = 3): boolean {
  if (scores.length - 1 >= maxRounds) return false;
  const deltas: number[] = [];
  for (let index = 1; index < scores.length; index += 1) deltas.push((scores[index] ?? 0) - (scores[index - 1] ?? 0));
  const lastTwo = deltas.slice(-2);
  return !(lastTwo.length === 2 && lastTwo.every((delta) => delta < 1));
}
