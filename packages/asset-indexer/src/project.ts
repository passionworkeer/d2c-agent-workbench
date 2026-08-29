import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { EvidenceRef, TargetProjectProfile } from "@d2c/contracts";
import { scanRepo } from "./index";

const execFileAsync = promisify(execFile);

export interface ProjectComponentIndex {
  name: string;
  importPath: string;
  sourceFile: string;
  figmaNames: string[];
  props: string[];
  nodeKeys: string[];
  evidence: EvidenceRef[];
  parseError?: string;
}

export interface ProjectTokenIndex {
  name: string;
  value: string | number;
  sourceFile: string;
  evidence: EvidenceRef[];
}

export interface ProjectIndex {
  version: "1.0";
  root: string;
  commitHash: string;
  versionHash: string;
  components: ProjectComponentIndex[];
  tokens: ProjectTokenIndex[];
}

export interface InspectTargetProjectInput {
  root: string;
  profile: TargetProjectProfile;
}

function toPosix(value: string): string {
  return sep === "/" ? value : value.split(sep).join("/");
}

function repositoryEvidence(sourceId: string, observation: string, confidence = 1): EvidenceRef {
  return { type: "repository", sourceId, observation, confidence };
}

function assertInsideRoot(root: string, candidate: string): void {
  const relativePath = relative(root, candidate);
  if (relativePath === "" || (!relativePath.startsWith(`..${sep}`) && relativePath !== ".." && !isAbsolute(relativePath))) return;
  throw new Error(`configured path escapes project root: ${candidate}`);
}

async function readTokens(root: string, paths: string[]): Promise<ProjectTokenIndex[]> {
  const tokens: ProjectTokenIndex[] = [];
  for (const configuredPath of paths) {
    const fullPath = resolve(root, configuredPath);
    assertInsideRoot(root, fullPath);
    let content: string;
    try {
      content = await readFile(fullPath, "utf8");
    } catch {
      continue;
    }
    const sourceFile = toPosix(relative(root, fullPath));
    if (configuredPath.endsWith(".json")) {
      try {
        const parsed = JSON.parse(content) as Record<string, unknown>;
        for (const [name, value] of Object.entries(parsed)) {
          if (typeof value !== "string" && typeof value !== "number") continue;
          tokens.push({ name, value, sourceFile, evidence: [repositoryEvidence(sourceFile, `Token ${name} 来自目标仓库`)] });
        }
      } catch {
        continue;
      }
      continue;
    }
    const cssVariable = /--([A-Za-z0-9-_]+)\s*:\s*([^;]+);/g;
    let match = cssVariable.exec(content);
    while (match) {
      const name = match[1];
      const value = match[2]?.trim();
      if (name && value) tokens.push({ name, value, sourceFile, evidence: [repositoryEvidence(sourceFile, `CSS Variable --${name}`)] });
      match = cssVariable.exec(content);
    }
  }
  return tokens.sort((left, right) => left.name.localeCompare(right.name));
}

async function readCommitHash(root: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root, timeout: 3_000 });
    const hash = stdout.trim();
    return /^[0-9a-f]{7,40}$/.test(hash) ? hash : "unknown";
  } catch {
    return "unknown";
  }
}

export async function inspectTargetProject(input: InspectTargetProjectInput): Promise<ProjectIndex> {
  const root = resolve(input.root);
  await access(root);
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) throw new Error(`target project is not a directory: ${root}`);

  for (const configured of [
    input.profile.routeEntry,
    ...input.profile.designSystemRoots,
    ...input.profile.tokenRoots,
    ...(input.profile.storybookRoots ?? []),
    ...(input.profile.codeConnectRoots ?? []),
  ]) assertInsideRoot(root, resolve(root, configured));

  const entries = await scanRepo({ repoRoot: root });
  const components: ProjectComponentIndex[] = entries.map((entry) => {
    const base = entry.sourceFile.replace(/\.tsx$/, "");
    const evidence = [repositoryEvidence(entry.sourceFile, `导出 React 组件 ${entry.codeComponent || "unknown"}`)];
    if (entry.storybook) evidence.push(repositoryEvidence(`${base}.stories.tsx`, `Storybook ${entry.storybook.title}`));
    if (entry.codeConnect) evidence.push(repositoryEvidence(`${base}.figma.tsx`, `Code Connect ${entry.codeConnect.nodeKeys.join(", ")}`));
    return {
      name: entry.codeComponent,
      importPath: entry.importPath,
      sourceFile: entry.sourceFile,
      figmaNames: entry.figmaNames,
      props: entry.props ?? [],
      nodeKeys: entry.codeConnect?.nodeKeys ?? [],
      evidence,
      ...(entry.parseError ? { parseError: entry.parseError } : {}),
    };
  });
  const tokens = await readTokens(root, input.profile.tokenRoots);
  const commitHash = await readCommitHash(root);
  const versionHash = createHash("sha256")
    .update(JSON.stringify({ commitHash, components, tokens }))
    .digest("hex");
  return { version: "1.0", root, commitHash, versionHash, components, tokens };
}
