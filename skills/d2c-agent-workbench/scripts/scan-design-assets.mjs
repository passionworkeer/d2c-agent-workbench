#!/usr/bin/env node

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ignoredDirectories = new Set([
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);
const maximumFiles = 10_000;

const targetArgument = process.argv[2];
if (!targetArgument) {
  console.error("用法：node scan-design-assets.mjs <target-repository>");
  process.exit(1);
}

const repository = path.resolve(targetArgument);
let repositoryStat;
try {
  repositoryStat = await stat(repository);
} catch {
  console.error(`目标仓库不存在：${repository}`);
  process.exit(1);
}
if (!repositoryStat.isDirectory()) {
  console.error(`目标路径不是目录：${repository}`);
  process.exit(1);
}

const files = [];
async function walk(directory) {
  if (files.length >= maximumFiles) return;
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (files.length >= maximumFiles) return;
    if (entry.isSymbolicLink()) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) await walk(absolutePath);
    } else if (entry.isFile()) {
      files.push(path.relative(repository, absolutePath).replaceAll(path.sep, "/"));
    }
  }
}
await walk(repository);

const result = {
  repository,
  components: [],
  stories: [],
  codeConnect: [],
  tokens: [],
  styles: [],
  configs: [],
  conventions: [],
  packageScripts: {},
  notes: [],
};

for (const file of files) {
  const name = path.posix.basename(file);
  const lowerName = name.toLowerCase();
  const extension = path.posix.extname(lowerName);

  if (/\.(tsx|jsx|vue|svelte)$/.test(lowerName) && /^[A-Z]/.test(name)) result.components.push(file);
  if (/\.stories\.(ts|tsx|js|jsx|mdx|vue|svelte)$/.test(lowerName)) result.stories.push(file);
  if (/\.figma\.(ts|tsx|js|jsx)$/.test(lowerName)) result.codeConnect.push(file);
  if (/(token|theme|variable)/.test(lowerName) && /\.(json|css|scss|ts|js)$/.test(lowerName)) result.tokens.push(file);
  if ([".css", ".scss", ".sass", ".less"].includes(extension)) result.styles.push(file);
  if (
    lowerName === "package.json" ||
    /^tsconfig.*\.json$/.test(lowerName) ||
    /^tailwind\.config\./.test(lowerName) ||
    lowerName === "vite.config.ts"
  ) result.configs.push(file);
  if (["agents.md", "contributing.md", "readme.md"].includes(lowerName)) result.conventions.push(file);

  if (lowerName === "package.json") {
    try {
      const packageJson = JSON.parse(await readFile(path.join(repository, ...file.split("/")), "utf8"));
      const key = file === "package.json" ? "root" : path.posix.dirname(file);
      result.packageScripts[key] = packageJson.scripts ?? {};
    } catch {
      result.notes.push(`无法解析 ${file}`);
    }
  }
}

if (files.length >= maximumFiles) result.notes.push(`扫描达到 ${maximumFiles} 个文件上限，结果可能不完整。`);
if (result.components.length === 0) result.notes.push("未发现常见前端组件文件。依然可以按 UISpec 生成局部组件。");
if (result.tokens.length === 0) result.notes.push("未发现显式 Design Token 文件。不要声称已复用企业 Token。");

console.log(JSON.stringify(result, null, 2));
