import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

// 固化实际 COMPLETED 记录；演示不依赖后端历史保留数量或临时工作区。
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataRoot = resolve(root, "apps/server/.data/production");
const outputRoot = resolve(root, "apps/web/public/production-demos");
const samples = ["commerce-feed", "summer-game-festival", "pet-red-packet"];
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const records = await Promise.all((await readdir(resolve(dataRoot, "runs")))
  .filter((id) => /^prod-[a-z0-9-]+$/.test(id))
  .map((id) => readJson(resolve(dataRoot, "runs", id, "run.json"))));
const requested = process.argv.slice(2);
if (requested.length && requested.length !== samples.length) throw new Error("需按商城、游戏节、养萌宠顺序指定三个实际 Run ID，或省略以选择各页最新成功记录。");

const bundles = [];
for (const [index, sampleId] of samples.entries()) {
  const record = requested.length ? records.find((item) => item.run.id === requested[index])
    : records.filter((item) => item.sampleId === sampleId && item.run.state === "COMPLETED")
      .sort((a, b) => b.run.createdAt.localeCompare(a.run.createdAt))[0];
  if (!record || record.sampleId !== sampleId || record.run.state !== "COMPLETED" || record.run.status !== "completed") {
    throw new Error(`${sampleId}: 没有对应的成功实跑记录`);
  }
  const { run, events } = record;
  const required = ["INPUT_VALIDATED", "PROJECT_INSPECTED", "SPEC_VALIDATED", "MAPPINGS_RESOLVED", "CODE_PLANNED", "GENERATED", "TYPECHECKED", "BUILT", "RENDERED", "EVALUATED", "ATTRIBUTED", "COMPLETED"];
  if (required.some((state) => !events.some((event) => event.state === state)) || events.at(-1)?.state !== "COMPLETED") {
    throw new Error(`${run.id}: 执行轨迹不完整`);
  }
  const artifacts = {};
  const artifactRoot = resolve(dataRoot, "artifacts");
  for (const artifact of run.artifacts) {
    const path = resolve(artifactRoot, artifact.path);
    const rel = relative(artifactRoot, path);
    if (isAbsolute(rel) || rel.startsWith("..")) throw new Error(`${run.id}: 产物路径越界`);
    artifacts[artifact.id] = { artifact, content: await readJson(path) };
  }
  for (const event of events) {
    if (event.runId !== run.id || !artifacts[event.data?.inputArtifactId]) throw new Error(`${run.id}/${event.state}: 缺少真实输入快照`);
    if (event.data?.artifactId && !artifacts[event.data.artifactId]) throw new Error(`${run.id}/${event.state}: 缺少输出`);
  }
  const output = artifacts[events.at(-1).data.artifactId]?.content;
  if (output?.contentsSource !== "run-end-snapshot" || !Object.keys(output.contents ?? {}).length || output.unavailableFiles?.length) {
    throw new Error(`${run.id}: 缺少完整的运行结束代码快照`);
  }
  for (const state of ["TYPECHECKED", "BUILT"]) {
    const event = events.findLast((item) => item.state === state);
    const result = artifacts[event.data.artifactId].content;
    if (result.exitCode !== 0 || typeof result.stdout !== "string" || typeof result.stderr !== "string") throw new Error(`${run.id}: ${state} 缺少成功命令日志`);
  }
  const rendered = events.findLast((event) => event.state === "RENDERED");
  const screenshots = {};
  const viewports = artifacts[rendered.data.artifactId].content.viewports;
  if (!viewports?.length) throw new Error(`${run.id}: 缺少渲染视口`);
  for (const viewport of viewports) {
    if (!/^[a-z0-9-]{1,32}$/.test(viewport.name)) throw new Error("非法视口名称");
    const png = await readFile(resolve(dataRoot, "renders", run.id, `${viewport.name}.png`));
    if (png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error(`${run.id}: 截图不是 PNG`);
    screenshots[viewport.name] = `data:image/png;base64,${png.toString("base64")}`;
  }
  bundles.push({ sampleId, recordedAt: run.createdAt, run: {
    ...run, sampleId, events, mappings: record.mappings,
    latestEvaluation: record.latestEvaluation,
    latestTextEvidence: record.latestTextEvidence,
    latestSemanticReview: record.latestSemanticReview,
  }, artifacts, screenshots });
}

// 三页全部校验成功后才写入，绝不把失败、缺失证据或虚构事件当作演示成功。
await mkdir(outputRoot, { recursive: true });
for (const bundle of bundles) {
  await writeFile(resolve(outputRoot, `${bundle.sampleId}.json`), JSON.stringify(bundle));
  console.log(`${bundle.sampleId}: ${bundle.run.id} · ${bundle.run.events.length} 个真实事件 · ${bundle.run.latestEvaluation.finalScore} 分`);
}
