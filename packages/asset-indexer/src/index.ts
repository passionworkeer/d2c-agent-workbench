import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

// 企业组件资产库扫描器：把设计系统仓库（React 组件 + Storybook + Code Connect）
// 扫描成 matcher 可注入的 RegistryEntry 列表，回答「怎么接我们公司设计系统」。
//
// 刻意零第三方依赖（不用 ts-morph / babel）：对 *.tsx 做约定化正则解析。
// 约定（examples/sample-design-system/README.md 有完整文档）：
//   - 组件：`export function ProductCard(...)` / `export const ProductCard =`
//   - Figma 名对照：兄弟 `<Name>.figma.tsx` 里 `export const figmaComponentNames = ["Product Card / Default", ...]`
//   - Code Connect：`figma.connect(<Component>, figma.node("<key>"), {...})`
//   - Storybook：兄弟 `<Name>.stories.tsx` 里 `title: "..."` + `argTypes: { prop: { control: ... } }`
// 单文件解析失败不阻断整体扫描，附 parseError 字段让上层看见。

export interface StorybookMeta {
  title: string;
  /** argTypes 里声明了 control 的 prop 名 */
  argTypes: string[];
}

export interface CodeConnectMeta {
  /** figma.node("<key>") 声明的节点 key */
  nodeKeys: string[];
}

export interface RegistryEntry {
  codeComponent: string;
  importPath: string;
  figmaNames: string[];
  /** 相对 repoRoot 的组件源文件路径（POSIX 风格） */
  sourceFile: string;
  storybook?: StorybookMeta;
  codeConnect?: CodeConnectMeta;
  /** 组件接受的 props（来自 Storybook argTypes） */
  props?: string[];
  parseError?: string;
}

export interface ScanRepoOptions {
  repoRoot: string;
  /** importPath 前缀，默认 "@/components" */
  aliasPrefix?: string;
  /** 最多访问的文件数（防误扫巨型 monorepo），默认 200 */
  maxFiles?: number;
  /** 目录黑名单，默认 ["node_modules", "dist", ".git", "coverage"] */
  ignored?: string[];
}

const DEFAULT_IGNORED = ["node_modules", "dist", ".git", "coverage"];
const DEFAULT_MAX_FILES = 200;
// 仅匹配组件本体：Header.tsx ✓；Header.stories.tsx / Header.figma.tsx 不匹配（含第二个点）
const COMPONENT_FILE_PATTERN = /^[A-Z][A-Za-z0-9]*\.tsx$/;
const EXPORT_PATTERN = /export\s+(?:function|const)\s+([A-Z][A-Za-z0-9]*)/;
const FIGMA_NAMES_PATTERN = /export\s+const\s+figmaComponentNames\s*=\s*\[([^\]]*)\]/;
const STORY_TITLE_PATTERN = /title:\s*"([^"]+)"/;
// argTypes 每个条目形如 `tone: { control: "select" }` —— 只认带 control 的键
const ARG_TYPE_KEY_PATTERN = /([A-Za-z][A-Za-z0-9_]*)\s*:\s*\{\s*control\b/g;
const FIGMA_NODE_PATTERN = /figma\.node\("([^"]+)"\)/g;

function toPosix(path: string): string {
  return sep === "/" ? path : path.split(sep).join("/");
}

function extractQuotedList(raw: string): string[] {
  const out: string[] = [];
  const pattern = /"([^"]+)"/g;
  let match = pattern.exec(raw);
  while (match) {
    if (match[1]) out.push(match[1]);
    match = pattern.exec(raw);
  }
  return out;
}

async function walkFiles(dir: string, options: Required<Pick<ScanRepoOptions, "ignored" | "maxFiles">>, budget: { count: number }, out: string[]): Promise<void> {
  if (budget.count >= options.maxFiles) return;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (options.ignored.includes(entry.name)) continue;
    if (budget.count >= options.maxFiles) return;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(full, options, budget, out);
    } else if (entry.isFile() && COMPONENT_FILE_PATTERN.test(entry.name)) {
      budget.count += 1;
      out.push(full);
    }
  }
}

function parseStories(content: string): StorybookMeta | undefined {
  const title = STORY_TITLE_PATTERN.exec(content)?.[1];
  if (!title) return undefined;
  const argTypes: string[] = [];
  let match = ARG_TYPE_KEY_PATTERN.exec(content);
  while (match) {
    if (match[1] && !argTypes.includes(match[1])) argTypes.push(match[1]);
    match = ARG_TYPE_KEY_PATTERN.exec(content);
  }
  ARG_TYPE_KEY_PATTERN.lastIndex = 0;
  return { title, argTypes };
}

function parseCodeConnect(content: string): CodeConnectMeta | undefined {
  if (!content.includes("figma.connect(")) return undefined;
  const nodeKeys: string[] = [];
  let match = FIGMA_NODE_PATTERN.exec(content);
  while (match) {
    if (match[1]) nodeKeys.push(match[1]);
    match = FIGMA_NODE_PATTERN.exec(content);
  }
  FIGMA_NODE_PATTERN.lastIndex = 0;
  return { nodeKeys };
}

export async function scanRepo(options: ScanRepoOptions): Promise<RegistryEntry[]> {
  const aliasPrefix = options.aliasPrefix ?? "@/components";
  const ignored = options.ignored ?? DEFAULT_IGNORED;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const files: string[] = [];
  await walkFiles(options.repoRoot, { ignored, maxFiles }, { count: 0 }, files);
  files.sort();

  const entries: RegistryEntry[] = [];
  for (const file of files) {
    const base = file.split(sep).pop()?.replace(/\.tsx$/, "") ?? "";
    const entry: RegistryEntry = {
      codeComponent: "",
      importPath: `${aliasPrefix}/${base}`,
      figmaNames: [],
      sourceFile: toPosix(relative(options.repoRoot, file)),
    };
    try {
      const componentSource = await readFile(file, "utf8");
      const exportName = EXPORT_PATTERN.exec(componentSource)?.[1];
      if (!exportName) {
        entry.parseError = "未找到 export function/const 组件声明";
      } else {
        entry.codeComponent = exportName;
      }

      const storiesFile = join(file.replace(/\.tsx$/, ".stories.tsx"));
      try {
        const storiesSource = await readFile(storiesFile, "utf8");
        const parsed = parseStories(storiesSource);
        if (parsed) {
          entry.storybook = parsed;
          entry.props = parsed.argTypes;
        }
      } catch {
        // 没有兄弟 stories 文件是正常情况（组件库可以只接 Code Connect）
      }

      const figmaFile = file.replace(/\.tsx$/, ".figma.tsx");
      try {
        const figmaSource = await readFile(figmaFile, "utf8");
        entry.figmaNames = extractQuotedList(
          FIGMA_NAMES_PATTERN.exec(figmaSource)?.[1] ?? "",
        );
        entry.codeConnect = parseCodeConnect(figmaSource);
      } catch {
        // 没有兄弟 Code Connect 文件是正常情况（组件库可以只接 Storybook）
      }
    } catch (error) {
      entry.parseError = error instanceof Error ? error.message : "文件读取失败";
    }
    entries.push(entry);
  }
  return entries;
}
