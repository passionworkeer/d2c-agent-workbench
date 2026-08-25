#!/usr/bin/env node

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { unzipSync, zipSync } from "fflate";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillDirectory = path.join(root, "skills", "d2c-agent-workbench");
const outputFile = path.join(root, "apps", "web", "public", "d2c-agent-workbench-skill.zip");
const archiveRoot = "d2c-agent-workbench";

async function collectFiles(directory, prefix = "") {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(absolutePath, relativePath));
    if (entry.isFile()) files.push({ absolutePath, relativePath });
  }
  return files;
}

async function canonicalEntries() {
  const files = await collectFiles(skillDirectory);
  const entries = {};
  for (const file of files) {
    entries[path.posix.join(archiveRoot, file.relativePath)] = new Uint8Array(await readFile(file.absolutePath));
  }
  return entries;
}

function compareArchive(expected, actual) {
  const expectedPaths = Object.keys(expected).sort();
  const actualPaths = Object.keys(actual).filter((file) => !file.endsWith("/")).sort();
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    throw new Error(`ZIP 路径与 canonical Skill 不一致。\n期望：${expectedPaths.join(", ")}\n实际：${actualPaths.join(", ")}`);
  }
  for (const file of expectedPaths) {
    if (!Buffer.from(actual[file]).equals(Buffer.from(expected[file]))) {
      throw new Error(`ZIP 文件内容已过期：${file}`);
    }
  }
}

const expected = await canonicalEntries();
if (process.argv.includes("--check")) {
  let archive;
  try {
    archive = unzipSync(new Uint8Array(await readFile(outputFile)));
  } catch (error) {
    throw new Error(`无法读取 Skill ZIP，请先运行 pnpm skill:build。${error instanceof Error ? ` ${error.message}` : ""}`);
  }
  compareArchive(expected, archive);
  console.log(`Skill ZIP 校验通过（${Object.keys(expected).length} 个文件）。`);
} else {
  const fixedTime = new Date("1980-01-01T00:00:00.000Z");
  const entries = Object.fromEntries(
    Object.entries(expected).map(([file, content]) => [file, [content, { mtime: fixedTime }]]),
  );
  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, zipSync(entries, { level: 9 }));
  console.log(`已生成 ${path.relative(root, outputFile)}（${Object.keys(expected).length} 个文件）。`);
}
