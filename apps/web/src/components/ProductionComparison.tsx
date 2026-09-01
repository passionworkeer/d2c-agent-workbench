import { useEffect, useRef, useState } from "react";
import { Code2, Figma, ImageIcon, Upload, ExternalLink, MousePointer2, Scan } from "lucide-react";
import type { GoldenSample, ProductionPreview } from "../lib/production-api";
import { LiveCodePreview, type InspectedNode } from "./LiveCodePreview";

interface ComparisonViewport {
  name: string;
  width: number;
  height: number;
  horizontalOverflow: boolean;
}

interface ProductionComparisonProps {
  sample?: GoldenSample;
  runId: string | null;
  renderRevision?: string;
  running: boolean;
  failed?: boolean;
  generated?: boolean;
  onInspectGenerated?: () => void;
  viewports: ComparisonViewport[];
  screenshots?: Record<string, string>;
  preview?: ProductionPreview;
}

function PreviewImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <p className="comparison-empty" role="status">{alt}加载失败，请重新导入或重试。</p>;
  return <a className="comparison-image-link" href={src} target="_blank" rel="noreferrer" aria-label={`查看完整${alt}`}>
    <img src={src} alt={alt} onError={() => setFailed(true)} />
  </a>;
}

export function ProductionComparison({ sample, runId, renderRevision, running, failed, generated, onInspectGenerated, viewports, screenshots, preview }: ProductionComparisonProps) {
  const [figmaImage, setFigmaImage] = useState<{ url: string; name: string } | null>(null);
  const [figmaOpen, setFigmaOpen] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedViewport, setSelectedViewport] = useState<string | null>(null);
  const [inspect, setInspect] = useState(false);
  const [showScreenshot, setShowScreenshot] = useState(false);
  const [selectedNode, setSelectedNode] = useState<InspectedNode | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (figmaImage) URL.revokeObjectURL(figmaImage.url); }, [figmaImage]);
  const referenceUrl = sample?.referenceUrl ?? sample?.thumbnailUrl;
  const canonicalWidth = sample?.payload.spec.page.canonicalViewport.width;
  const activeViewport = viewports.find((viewport) => viewport.name === selectedViewport)
    ?? viewports.find((viewport) => viewport.width === canonicalWidth) ?? viewports[0];
  const livePreview = preview?.runId === runId && preview.url === `/production-previews/index.html?run=${encodeURIComponent(runId ?? "")}` ? preview : undefined;
  const live = livePreview && activeViewport && !showScreenshot;
  const nodeSource = selectedNode ? livePreview?.nodes[selectedNode.id] : undefined;

  return <div className="production-comparison" data-testid="production-comparison">
    <section className="comparison-panel comparison-reference" aria-label="原始图片">
      <header className="comparison-panel-head">
        <h3><ImageIcon size={16} /> 原始图片</h3><span>REFERENCE · 对照基准</span>
      </header>
      <div className="comparison-canvas">
        {referenceUrl ? <PreviewImage key={referenceUrl} src={referenceUrl} alt="原始参考图" /> : (
          <div className="comparison-empty"><ImageIcon size={28} /><strong>{sample ? "该样例没有原始图片" : "先选择一个活动页"}</strong><p>原始图片会显示在这里，作为代码页面的对照基准。</p></div>
        )}
      </div>
      <footer className="comparison-panel-foot">
        <strong>{sample?.label ?? "尚未选择样例"}</strong>
        <span>原始截图 · 等比例完整显示，点击查看原图</span>
      </footer>
    </section>

    <section className="comparison-panel comparison-code" aria-label="代码渲染图">
      <header className="comparison-panel-head">
        <h3><Code2 size={16} /> {live ? "代码实时预览" : "代码渲染图"}</h3>
        <div className="code-preview-controls">
          {livePreview && <>
            <button className="button secondary" aria-pressed={!showScreenshot && !inspect} onClick={() => { setShowScreenshot(false); setInspect(false); }}><MousePointer2 size={13} />页面交互</button>
            <button className="button secondary" aria-pressed={!showScreenshot && inspect} onClick={() => { setShowScreenshot(false); setInspect(true); }}><Scan size={13} />组件检查</button>
            <button className="button secondary" aria-pressed={showScreenshot} onClick={() => setShowScreenshot((value) => !value)}>运行截图</button>
            <a className="button secondary" href={livePreview.url} target="_blank" rel="noreferrer" aria-label="新窗口打开真实页面"><ExternalLink size={13} /></a>
          </>}
          {!livePreview && generated && <button className="button secondary" onClick={onInspectGenerated}>查看已生成代码</button>}
        </div>
      </header>
      <div className="comparison-canvas">
        {live ? <LiveCodePreview key={`${livePreview.url}-${activeViewport.name}`} url={livePreview.url} width={activeViewport.width} height={activeViewport.height} inspect={inspect} onSelect={setSelectedNode} /> : runId && viewports.length > 0 ? (
          <div className="comparison-render-shots" data-testid="render-shots">
            {viewports.map((viewport) => {
              const src = screenshots?.[viewport.name] ?? `/api/production/runs/${runId}/renders/${viewport.name}${renderRevision ? `?revision=${encodeURIComponent(renderRevision)}` : ""}`;
              return <figure key={viewport.name} className={viewport.horizontalOverflow ? "overflow" : undefined} hidden={viewport.name !== activeViewport?.name} data-testid={`render-shot-${viewport.name}`}>
                <PreviewImage key={src} src={src} alt={`${viewport.name} ${viewport.width}×${viewport.height} 截图`} />
                <figcaption>{viewport.name} · {viewport.width}×{viewport.height}{viewport.horizontalOverflow && <span className="render-shot-overflow" data-testid={`render-shot-overflow-${viewport.name}`}> ⚠ 横向溢出 → P1</span>}</figcaption>
              </figure>;
            })}
          </div>
        ) : (
          <div className="comparison-empty"><Code2 size={28} /><strong>{running ? "正在构建并渲染代码" : failed ? "本次运行失败，尚未生成截图" : "等待代码预览"}</strong><p>{running ? "截图生成后会自动显示在这里。" : failed ? generated ? "代码已生成。请展开「真实代码已写入工作区」查看产物，展开失败步骤查看原因。" : "请展开失败步骤查看原因，前面步骤的产物仍保留。" : "选中活动页并点击「运行 Mock 演示」，打开已生成代码的真实交互页面。"}</p>{failed && <a href="#production-trace">查看执行轨迹与产物</a>}</div>
        )}
      </div>
      <footer className="comparison-panel-foot code-preview-foot">
        <div className="code-preview-meta">
          <strong>{live ? "React 页面运行中" : "Playwright 实拍"} · {runId ?? "尚未运行"}</strong>
          {activeViewport && <select aria-label="代码渲染视口" value={activeViewport.name} onChange={(event) => { setSelectedViewport(event.target.value); setSelectedNode(null); }}>
            {viewports.map((viewport) => <option key={viewport.name} value={viewport.name}>{viewport.name} · {viewport.width}×{viewport.height}</option>)}
          </select>}
          {livePreview && generated && <button className="button secondary" onClick={onInspectGenerated}>查看已生成代码</button>}
        </div>
        {live && (selectedNode && inspect ? <output className="code-node-info" aria-label="选中组件信息">
          <strong>{nodeSource?.name ?? selectedNode.id}</strong> <code>{`<${selectedNode.tag}> ${selectedNode.id}`}</code> · {Math.round(selectedNode.width)} × {Math.round(selectedNode.height)} px
          <span>{nodeSource?.file ?? "该 DOM 节点无独立源码定位"}{nodeSource?.styleSelector ? ` · ${nodeSource.styleSelector}` : ""}</span>
        </output> : <span>{inspect ? "悬停查看边界，点击框选真实 DOM；Esc 取消选择。检查模式不会触发业务操作。" : "可点击与滚动操作；切到「组件检查」可查看真实节点边界与源码位置。"}</span>)}
      </footer>
    </section>

    <section className="comparison-panel comparison-figma" aria-label="Figma 渲染图">
      <details open={figmaOpen} onToggle={(event) => setFigmaOpen(event.currentTarget.open)}>
        <summary><Figma size={16} /><strong>Figma 渲染图</strong><span>暂不展示 · 需要时展开导入</span></summary>
        <header className="comparison-panel-head">
          <h3>Figma 导出图片对照</h3>
          <button className="button secondary" disabled={!sample} onClick={() => uploadRef.current?.click()}><Upload size={13} />{figmaImage ? "替换 Figma 图片" : "导入 Figma 图片"}</button>
          <input ref={uploadRef} type="file" hidden accept="image/png,image/jpeg,image/webp" aria-label="导入 Figma 渲染图" onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) { setUploadError("请选择 Figma 导出的 PNG、JPG 或 WebP 图片。"); return; }
            setUploadError(null);
            setFigmaOpen(true);
            setFigmaImage({ url: URL.createObjectURL(file), name: file.name });
          }} />
        </header>
        <div className="comparison-canvas">
          {figmaImage ? <PreviewImage key={figmaImage.url} src={figmaImage.url} alt="Figma 导出渲染图" /> : (
            <div className="comparison-empty"><Figma size={28} /><strong>等待 Figma 渲染图</strong><p>将导入包放入 Figma 后，导出页面图片并在此导入。</p><small>当前尚未接入 Figma 渲染结果自动回传。</small></div>
          )}
        </div>
        <footer className="comparison-panel-foot">{uploadError ? <span role="alert">{uploadError}</span> : figmaImage ? `本地导入 · ${figmaImage.name} · 仅用于本次对照` : "独立的 Figma 导出图片 · 不以原图代替"}</footer>
      </details>
    </section>
  </div>;
}
