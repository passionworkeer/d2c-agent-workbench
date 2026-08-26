import type { ReactElement } from "react";
import type { UISpec, UISpecNode } from "@d2c/contracts";

// 通用 UISpec → JSX 渲染器：按 semanticRole / figmaComponent 派发到不同可视分支。
// 同一个组件既能渲染商品网格也能渲染表单页：和现有 ProductPreview 等价，
// 但根据节点身份而不是硬编码 ID 选择样式，保证 demo 叙事里「同一渲染器，吃进不同 fixture」的可信度。

export interface SpecRendererProps {
  uiSpec: UISpec;
}

function getToneClass(tone: unknown): string {
  if (typeof tone !== "string") return "cobalt";
  return ["cobalt", "coral", "lime", "charcoal"].includes(tone) ? tone : "cobalt";
}

function getStateClass(state: unknown): string {
  if (typeof state !== "string") return "default";
  return ["default", "error"].includes(state) ? state : "default";
}

function getShape(index: number): string {
  return (["circle", "capsule", "triangle", "orbit"] as const)[index % 4] ?? "circle";
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
    const tone = getToneClass(props.tone);
    const badge = typeof props.badge === "string" ? props.badge : "New";
    return (
      <article className={`product-card ${tone}`}>
        <div className={`product-shape ${getShape(index)}`} />
        <div>
          <strong>{productNames[index % 4]}</strong>
          <span>{productMetas[index % 4]}</span>
        </div>
        <span className="badge">{badge}</span>
      </article>
    );
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
      return <div className="product-grid">{children}</div>;
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
