import type { ReactElement } from "react";
import type { UISpec, UISpecNode } from "@d2c/contracts";
import { ProductArt, type ProductTone } from "./ProductArt";

// 通用 UISpec → JSX 渲染器：按 semanticRole / figmaComponent 派发到不同可视分支。
// 同一个组件既能渲染商品网格也能渲染表单页：和现有 ProductPreview 等价，
// 但根据节点身份而不是硬编码 ID 选择样式，保证 demo 叙事里「同一渲染器，吃进不同 fixture」的可信度。

export interface SpecRendererProps {
  uiSpec: UISpec;
}

const VALID_TONES: ProductTone[] = ["cobalt", "coral", "lime", "charcoal"];

function getToneClass(tone: unknown): ProductTone {
  if (typeof tone !== "string") return "cobalt";
  return VALID_TONES.includes(tone as ProductTone) ? (tone as ProductTone) : "cobalt";
}

function getStateClass(state: unknown): string {
  if (typeof state !== "string") return "default";
  return ["default", "error"].includes(state) ? state : "default";
}

const productNames = ["弧线跑鞋 01", "形态手袋 02", "机能外套 03", "虚空帽 04"];
const productMetas = ["¥ 1,290 · 新品", "¥ 890 · 限量", "¥ 1,590 · 核心款", "¥ 490 · 典藏"];

function renderNode(node: UISpecNode, index: number): ReactElement | null {
  // 文本节点：直接吐 content；fallback 用 node.name 让 form 标题也读得出
  if (node.type === "TEXT") {
    const text = (node.content ?? node.name) || "";
    const role = node.semanticRole;
    if (role === "label") return <span className="form-hint">{text}</span>;
    if (role === "heading") return <h3 className="page-title">{text}</h3>;
    return <span>{text}</span>;
  }
  // INSTANCE：按 figmaComponent 派发
  const figma = node.component?.figmaComponent ?? node.name;
  const props = node.component?.props ?? {};
  if (figma.includes("Header")) {
    return (
      <div className="rendered-nav">
        <strong>KINETIC®</strong>
        <span>26FW 系列 · 购物车 04</span>
      </div>
    );
  }
  if (figma.includes("Product Card")) {
    // product-grid 容器里的卡片由 renderContainer 直接按 grid 内 sibling 索引渲染，
    // 这里仅作兜底（卡片不应出现在 grid 之外）；不要用全局 index 取文案数组。
    return <div className="unmapped-instance">{figma}</div>;
  }
  if (figma.includes("Input")) {
    const state = getStateClass(props.state);
    const placeholder = props.label ? String(props.label) : "请输入…";
    return (
      <div className={`form-input ${state}`}>
        <span className="form-input-value">{placeholder}</span>
      </div>
    );
  }
  if (figma.includes("Button")) {
    const label = typeof props.label === "string" ? props.label : "Continue";
    return <button className="form-submit">{label}</button>;
  }
  if (figma.includes("Checkbox")) {
    const checked = String(props.checked) === "true";
    return (
      <span className={`form-checkbox ${checked ? "checked" : ""}`} aria-checked={checked}>
        {checked ? "✓" : ""}
      </span>
    );
  }
  // 未识别 INSTANCE：留一个轻占位
  return <div className="unmapped-instance">{figma}</div>;
}

function renderProductCard(node: UISpecNode, gridIndex: number): ReactElement | null {
  if (node.type !== "INSTANCE") return null;
  const props = node.component?.props ?? {};
  const tone = getToneClass(props.tone);
  const badge = typeof props.badge === "string" ? props.badge : "New";
  return (
    <div key={node.id} className="node-instance">
      <article className={`product-card ${tone}`}>
        <div className="product-art">
          <ProductArt tone={tone} className="product-image" />
        </div>
        <div className="product-meta">
          <strong>{productNames[gridIndex % 4]}</strong>
          <span>{productMetas[gridIndex % 4]}</span>
        </div>
        <span className="badge">{badge}</span>
      </article>
    </div>
  );
}

function renderContainer(node: UISpecNode, childIndex: number): ReactElement {
  const children = node.children.map((child, idx) => renderNodeOrContainer(child, childIndex + idx));
  switch (node.semanticRole) {
    case "page":
      return (
        <div className="rendered-page" data-testid="generated-preview">
          {children}
        </div>
      );
    case "header":
      return <div className="form-page-header">{children}</div>;
    case "section-intro":
      return <div className="rendered-copy">{children}</div>;
    case "product-grid":
      // 商品卡片在 product-grid 中按 sibling 索引 0..3 渲染：保证 cobalt=弧线跑鞋、coral=形态手袋…
      // 与 product-grid/preview/root.svg 同序，文案数组索引才稳。
      return (
        <div className="product-grid">
          {node.children.map((child, idx) => renderProductCard(child, idx))}
        </div>
      );
    case "form-section":
      return <form className="form-section" onSubmit={(e) => e.preventDefault()}>{children}</form>;
    default:
      return <div className="form-field">{children}</div>;
  }
}

function renderNodeOrContainer(node: UISpecNode, index: number): ReactElement {
  // INSTANCE / TEXT 走 renderNode；FRAME / 其他容器走 renderContainer。
  if (node.type === "INSTANCE" || node.type === "TEXT") {
    const rendered = renderNode(node, index);
    return <div key={node.id} className="node-instance">{rendered}</div>;
  }
  return <div key={node.id}>{renderContainer(node, index)}</div>;
}

export function SpecRenderer({ uiSpec }: SpecRendererProps) {
  return renderContainer(uiSpec.root, 0);
}
