import { useEffect, useRef, useState } from "react";

export interface InspectedNode {
  id: string;
  tag: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

// 读取 iframe 内真实 DOM 的坐标；覆盖框不截获鼠标，不以参考图坐标模拟选中。
export function LiveCodePreview({ url, width, height, inspect, onSelect }: {
  url: string;
  width: number;
  height: number;
  inspect: boolean;
  onSelect: (node: InspectedNode | null) => void;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [revision, setRevision] = useState(0);
  const [scale, setScale] = useState(1);
  const [hovered, setHovered] = useState<InspectedNode | null>(null);
  const [selected, setSelected] = useState<InspectedNode | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const fit = () => {
      const box = host.getBoundingClientRect();
      if (box.width && box.height) setScale(Math.min(box.width / width, box.height / height));
    };
    const observer = new ResizeObserver(fit);
    observer.observe(host);
    fit();
    return () => observer.disconnect();
  }, [width, height]);

  useEffect(() => {
    setHovered(null);
    setSelected(null);
    onSelect(null);
    if (!revision) return;
    let doc: Document | null;
    try { doc = frameRef.current?.contentDocument ?? null; } catch { doc = null; }
    if (!doc) { setError("无法读取代码页面，请在新窗口打开检查。"); return; }
    let selectedElement: Element | null = null;
    let hoveredElement: Element | null = null;
    const evidence = (element: Element): InspectedNode => {
      const box = element.getBoundingClientRect();
      return { id: element.getAttribute("data-d2c-node-id")!, tag: element.tagName.toLowerCase(), text: (element.textContent ?? "").trim().slice(0, 100), x: box.x, y: box.y, width: box.width, height: box.height };
    };
    const hit = (event: Event) => {
      const target = event.target as Element | null;
      return target?.closest?.("[data-d2c-node-id]") ?? null;
    };
    const update = () => {
      if (doc.querySelector('[data-d2c-ready="true"]')) { setReady(true); setError(null); }
      if (selectedElement && !selectedElement.isConnected) selectedElement = null;
      const next = selectedElement ? evidence(selectedElement) : null;
      setSelected(next);
      onSelect(next);
      setHovered(hoveredElement?.isConnected ? evidence(hoveredElement) : null);
    };
    const move = (event: MouseEvent) => {
      if (!inspect) return;
      hoveredElement = hit(event);
      setHovered(hoveredElement ? evidence(hoveredElement) : null);
    };
    const leave = () => { hoveredElement = null; setHovered(null); };
    const click = (event: MouseEvent) => {
      if (!inspect) return;
      const element = hit(event);
      if (!element) return;
      event.preventDefault();
      event.stopPropagation();
      selectedElement = element;
      update();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { selectedElement = null; hoveredElement = null; update(); }
    };
    const observer = new MutationObserver(update);
    observer.observe(doc.documentElement, { childList: true, subtree: true, characterData: true });
    doc.addEventListener("mousemove", move);
    doc.addEventListener("mouseleave", leave);
    // disabled 按钮不派发 click，但仍可通过 pointerdown 检查其真实节点。
    doc.addEventListener("pointerdown", click, true);
    doc.addEventListener("click", click, true);
    doc.addEventListener("keydown", key);
    doc.addEventListener("scroll", update, true);
    frameRef.current?.contentWindow?.addEventListener("resize", update);
    update();
    const timeout = window.setTimeout(() => {
      if (!doc.querySelector('[data-d2c-ready="true"]')) setError("代码页面未能加载，请重新打开预览。不会用截图替代运行结果。");
    }, 12_000);
    return () => {
      window.clearTimeout(timeout);
      observer.disconnect();
      doc.removeEventListener("mousemove", move);
      doc.removeEventListener("mouseleave", leave);
      doc.removeEventListener("pointerdown", click, true);
      doc.removeEventListener("click", click, true);
      doc.removeEventListener("keydown", key);
      doc.removeEventListener("scroll", update, true);
      doc.defaultView?.removeEventListener("resize", update);
    };
  }, [revision, inspect, onSelect, width, height]);

  return <div ref={hostRef} className="live-code-preview" data-ready={ready}>
    {!ready && !error && <p className="live-preview-status" role="status">正在运行真实页面代码…</p>}
    {error && <p className="live-preview-status" role="alert">{error}</p>}
    <div className="live-preview-viewport" style={{ width: width * scale, height: height * scale }}>
      <iframe ref={frameRef} src={url} title="真实代码交互预览" sandbox="allow-scripts allow-same-origin" onLoad={() => setRevision((value) => value + 1)}
        style={{ width, height, transform: `scale(${scale})` }} />
      {inspect && [hovered?.id !== selected?.id ? hovered : null, selected].map((node, index) => node && (
        <div key={index} className={`live-node-outline ${index === 1 ? "selected" : "hovered"}`} data-node-id={node.id}
          style={{ left: node.x * scale, top: node.y * scale, width: node.width * scale, height: node.height * scale }}>
          <span>{node.id} · {Math.round(node.width)} × {Math.round(node.height)}</span>
        </div>
      ))}
    </div>
  </div>;
}
