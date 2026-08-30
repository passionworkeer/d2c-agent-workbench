import { comparePixelImages } from "./visual-report";

type Bundle = { viewport: { width: number; height: number }; assets: Array<{ id: string; mimeType: string; data: string }>; manifest: { name: string; referenceAssetId?: string }; degradations: unknown[]; nodes: unknown[] };
let pendingBundle: Bundle | null = null;
let rootId: string | null = null;
let importReport: { degradations?: unknown[] } | null = null;
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fileInput = byId<HTMLInputElement>("file");
const importButton = byId<HTMLButtonElement>("import");
const verifyButton = byId<HTMLButtonElement>("verify");
const reportBox = byId<HTMLDivElement>("report");

function report(message: string, error = false) { reportBox.className = error ? "error" : ""; reportBox.textContent = message; }
function dataUrl(mime: string, data: string) { return `data:${mime};base64,${data}`; }
function download(name: string, value: BlobPart, type: string) { const url = URL.createObjectURL(new Blob([value], { type })); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); }
async function canvasFrom(source: string, width: number, height: number) {
  const image = new Image(); image.src = source; await image.decode();
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  canvas.getContext("2d")!.drawImage(image, 0, 0, width, height); return canvas;
}
function flatten(nodes: unknown[]): unknown[] { return nodes.flatMap((node) => { const value = node as { children?: unknown[] }; return [node, ...flatten(value.children ?? [])]; }); }

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0]; pendingBundle = null; rootId = null; verifyButton.disabled = true; importButton.disabled = true;
  if (!file) return report("");
  const reader = new FileReader(); reader.onload = () => { try { pendingBundle = JSON.parse(String(reader.result)) as Bundle; importButton.disabled = false; report(`已选择 ${file.name}，点击导入。`); } catch { report("JSON 解析失败", true); } }; reader.readAsText(file);
});
importButton.addEventListener("click", () => { if (pendingBundle) { importButton.disabled = true; report("导入中…"); parent.postMessage({ pluginMessage: { type: "import-bundle", bundle: pendingBundle } }, "*"); } });
verifyButton.addEventListener("click", () => { if (rootId) { verifyButton.disabled = true; report("Figma 正在导出 PNG…"); parent.postMessage({ pluginMessage: { type: "export-root-png", rootId } }, "*"); } });
onmessage = async (event) => {
  const message = event.data.pluginMessage; if (!message) return;
  if (message.type === "import-error") { importButton.disabled = !pendingBundle; verifyButton.disabled = !rootId; return report(`失败：${message.message}`, true); }
  if (message.type === "import-report") { importReport = message.report; rootId = message.report.rootIds?.[0] ?? null; importButton.disabled = !pendingBundle; verifyButton.disabled = !rootId; return report(`导入完成：${message.report.createdNodes} 个节点。点击“导出并验证”。`); }
  if (message.type !== "figma-root-png" || !pendingBundle) return;
  try {
    if (message.width !== pendingBundle.viewport.width || message.height !== pendingBundle.viewport.height) throw new Error(`根 Frame 尺寸 ${message.width}×${message.height} 与 viewport 不一致`);
    const asset = pendingBundle.assets.find((item) => item.id === pendingBundle!.manifest.referenceAssetId);
    if (!asset) throw new Error("导入包缺少 referenceAssetId 素材");
    const actualBlob = new Blob([new Uint8Array(message.bytes)], { type: "image/png" });
    const actualUrl = URL.createObjectURL(actualBlob);
    const [reference, actual] = await Promise.all([canvasFrom(dataUrl(asset.mimeType, asset.data), message.width, message.height), canvasFrom(actualUrl, message.width, message.height)]);
    URL.revokeObjectURL(actualUrl);
    const comparison = comparePixelImages({ width: reference.width, height: reference.height, data: reference.getContext("2d")!.getImageData(0, 0, reference.width, reference.height).data }, { width: actual.width, height: actual.height, data: actual.getContext("2d")!.getImageData(0, 0, actual.width, actual.height).data });
    const diff = document.createElement("canvas"); diff.width = actual.width; diff.height = actual.height; const imageData = diff.getContext("2d")!.createImageData(diff.width, diff.height);
    comparison.diffMask.forEach((value, index) => { if (value) { const offset = index * 4; imageData.data[offset] = 255; imageData.data[offset + 3] = 180; } }); diff.getContext("2d")!.putImageData(imageData, 0, 0);
    const degradations = [...pendingBundle.degradations, ...(importReport?.degradations ?? [])];
    const blocking = degradations.filter((item) => (item as { type?: string }).type !== "missing-render-evidence");
    const nodes = flatten(pendingBundle.nodes) as Array<{ renderKind?: string }>;
    const artifact = { fixtureId: pendingBundle.manifest.name, frame: { width: message.width, height: message.height }, visual: comparison, editability: { native: nodes.filter((node) => node.renderKind === "native").length, raster: nodes.filter((node) => node.renderKind === "raster").length }, degradations };
    download("figma-export.png", actualBlob, "image/png"); diff.toBlob((blob) => blob && download("figma-diff.png", blob, "image/png")); download("figma-visual-report.json", JSON.stringify(artifact, null, 2), "application/json");
    report(comparison.score >= 95 && blocking.length === 0 ? `验证通过：视觉分 ${comparison.score}` : `未通过：视觉分 ${comparison.score}，阻塞降级 ${blocking.length} 项`, comparison.score < 95 || blocking.length > 0);
  } catch (cause) { report(`验证失败：${cause instanceof Error ? cause.message : "未知错误"}`, true); } finally { verifyButton.disabled = !rootId; }
};
