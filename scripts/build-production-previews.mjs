import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// 把已保存 Run 的原始 TSX/CSS 快照与目标仓库组件一起构建为真正的 React 应用。
// 页面状态、按钮、输入框由原组件运行；不把截图当作页面。
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(root, "examples/activity-target");
const demoRoot = resolve(root, "apps/web/public/production-demos");
const output = resolve(root, "apps/web/public/production-previews");
const base = "/production-previews/";
await mkdir(resolve(root, "output"), { recursive: true });
const staging = await mkdtemp(resolve(root, "output/production-preview-"));
await cp(resolve(target, "src/components"), resolve(staging, "src/components"), { recursive: true });
const samples = ["commerce-feed", "summer-game-festival", "pet-red-packet"];
const bundles = [];
const imports = [];
const cases = [];
const sources = {};
const safePath = (folder, path) => {
  const result = resolve(folder, path);
  const rel = relative(folder, result);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`代码路径越界: ${path}`);
  return result;
};
for (const [index, sampleId] of samples.entries()) {
  const bundle = JSON.parse(await readFile(resolve(demoRoot, `${sampleId}.json`), "utf8"));
  if (bundle.run.state !== "COMPLETED" || bundle.run.sampleId !== sampleId || !/^prod-[a-z0-9-]+$/.test(bundle.run.id)) throw new Error("只构建对应页面已成功实跑的代码");
  const snapshot = bundle.artifacts[bundle.run.events.at(-1).data.artifactId].content;
  if (snapshot.contentsSource !== "run-end-snapshot" || snapshot.unavailableFiles?.length) throw new Error("运行源码快照不完整");
  const entries = Object.entries(snapshot.contents);
  const entry = entries.find(([path]) => path.endsWith("Page.tsx"));
  if (!entry) throw new Error(`${sampleId}: 找不到生成页面入口`);
  for (const [path, source] of entries) {
    const destination = safePath(resolve(staging, "cases", bundle.run.id), path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, source);
    sources[`${bundle.run.id}/${path}`] = createHash("sha256").update(source).digest("hex");
  }
  imports.push(`import Page${index} from ${JSON.stringify(`./cases/${bundle.run.id}/${entry[0]}`)};`);
  cases.push(`${JSON.stringify(bundle.run.id)}: Page${index}`);
  const specEvent = bundle.run.events.findLast((event) => event.state === "SPEC_VALIDATED");
  const spec = bundle.artifacts[specEvent.data.artifactId].content;
  const sourceMap = JSON.parse(entries.find(([path]) => path.endsWith("d2c-source-map.json"))[1]);
  bundle.preview = {
    runId: bundle.run.id, builtAt: new Date().toISOString(),
    url: `${base}index.html?run=${encodeURIComponent(bundle.run.id)}`,
    nodes: Object.fromEntries(spec.nodes.map((node) => {
      const locator = sourceMap.locators.find((item) => item.nodeId === node.id);
      return [node.id, { name: node.name, role: node.role, ...locator }];
    })),
  };
  bundles.push(bundle);
}
await writeFile(resolve(staging, "index.html"), '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>活动页 · 真实代码预览</title></head><body style="margin:0"><div id="root"></div><script type="module" src="/preview.tsx"></script></body></html>');
await writeFile(resolve(staging, "preview.tsx"), `import React from "react";
import { createRoot } from "react-dom/client";
${imports.join("\n")}
const pages = { ${cases.join(",")} };
const runId = new URLSearchParams(location.search).get("run");
const Page = pages[runId];
createRoot(document.getElementById("root")).render(Page ? <Page /> : <p role="alert">未找到该 Run 的真实代码预览。</p>);
`);
// 所有依赖从目标仓库解析，不安装新依赖；root 为临时构建目录。
const { build } = await import(pathToFileURL(resolve(target, "node_modules/vite/dist/node/index.js")).href);
const publicDirectories = (await readdir(resolve(target, "public"), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
await build({
  configFile: false, root: staging, base, publicDir: resolve(target, "public"),
  resolve: { alias: {
    "@": resolve(staging, "src"),
    "react": resolve(target, "node_modules/react"),
    "react-dom": resolve(target, "node_modules/react-dom"),
  } },
  esbuild: { jsx: "automatic" },
  plugins: [{ name: "preview-public-asset-paths", enforce: "pre", transform(code, id) {
    if (!/\.[jt]sx?$/.test(id) || id.includes("node_modules")) return;
    // 只调整静态素材部署前缀；保存的源码本身不作改写。
    for (const folder of publicDirectories) {
      code = code.replaceAll(`"/${folder}/`, `"${base}${folder}/`).replaceAll(`'/${folder}/`, `'${base}${folder}/`);
    }
    return code;
  } }],
  build: { outDir: output, emptyOutDir: false },
});
// 记录实际参与打包的共享组件版本，预览来源与历史日志分开标注。
for (const path of await readdir(resolve(staging, "src/components"), { recursive: true })) {
  if (!/\.(tsx|css)$/.test(path) || /\.test\./.test(path)) continue;
  const content = await readFile(resolve(staging, "src/components", path));
  sources[`components/${path.replaceAll("\\", "/")}`] = createHash("sha256").update(content).digest("hex");
}
await writeFile(resolve(output, "build-manifest.json"), JSON.stringify({ builtAt: bundles[0].preview.builtAt, runs: bundles.map((bundle) => ({ sampleId: bundle.sampleId, runId: bundle.run.id })), sources }, null, 2));
for (const bundle of bundles) await writeFile(resolve(demoRoot, `${bundle.sampleId}.json`), JSON.stringify(bundle));
console.log(`已构建三个实跑源码预览：${bundles.map((bundle) => bundle.run.id).join("、")}`);
