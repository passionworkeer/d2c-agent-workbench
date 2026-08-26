import type { ComponentMapping, UISpec, UISpecNode } from "@d2c/contracts";

// 本文件保留 mockUiSpec + mockMappings 两个常量供 I2D 设计稿演示链路复用，
// 以及服务真链路产物的逐字段对齐参考（scripts/consistency.test.ts 守护）。
// D2C 演示已迁移至 lib/local-run.ts，直接走真实 figma-importer → ui-compiler → matcher → orchestrator。

const previewSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500"><rect width="800" height="500" fill="#f4f1e8"/><rect x="24" y="24" width="752" height="56" rx="10" fill="#171a16"/><text x="48" y="60" fill="#fff" font-family="Arial" font-weight="700" font-size="18">KINETIC®</text><text x="24" y="130" fill="#f05a2a" font-family="Arial" font-size="12">全新系列 / 26FW</text><text x="24" y="170" fill="#171a16" font-family="Arial" font-weight="700" font-size="34">为运动而生的设计。</text><rect x="24" y="205" width="176" height="250" rx="12" fill="#3154e8"/><rect x="216" y="205" width="176" height="250" rx="12" fill="#f05a2a"/><rect x="408" y="205" width="176" height="250" rx="12" fill="#b8e636"/><rect x="600" y="205" width="176" height="250" rx="12" fill="#292927"/><circle cx="112" cy="315" r="42" fill="#f4f1e8"/><rect x="282" y="270" width="44" height="88" rx="22" fill="#171a16"/><path d="M496 270l48 88h-96z" fill="#171a16"/><ellipse cx="688" cy="315" rx="49" ry="25" fill="none" stroke="#f4f1e8" stroke-width="18" transform="rotate(-15 688 315)"/><g fill="#fff" font-family="Arial" font-size="12" font-weight="700"><text x="38" y="420">弧线跑鞋 01</text><text x="230" y="420">形态手袋 02</text><text x="614" y="420">虚空帽 04</text></g><text x="422" y="420" fill="#171a16" font-family="Arial" font-size="12" font-weight="700">机能外套 03</text></svg>`;

export const previewUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(previewSvg)}`;

// mock uiSpec 必须与 examples/figma-bundles/product-grid 通过 orchestrator 跑出来的真实结构 1:1 对齐：
// - 10 个 UI 节点（1 page + 1 header + 1 intro + 2 intro 子节点 + 1 grid + 4 card）。
// - 10 个 Design Token（5 spacing + 5 color/typography）；collectBoundTokens 集合去重后正好 = 10。
// - 5 个 SDS 组件实例（1 Header + 4 ProductCard），nodeId 与 mockMappings 一致。
// 一致性由 scripts/consistency.test.ts 守护。
const cards = [
  { id: "card-1", tone: "cobalt", badge: "New" },
  { id: "card-2", tone: "coral", badge: "Limited" },
  { id: "card-3", tone: "lime", badge: "Core" },
  { id: "card-4", tone: "charcoal", badge: "Archive" },
];

const cardNodes: UISpecNode[] = cards.map((card) => ({
  id: card.id,
  name: "Product Card / Default",
  type: "INSTANCE",
  semanticRole: "product-card",
  layout: {
    direction: "column",
    width: "fill",
    height: "hug",
    gap: { value: 16, variable: "spacing/lg" },
  },
  component: {
    figmaComponent: "Product Card / Default",
    codeComponent: "ProductCard",
    importPath: "@/components/ProductCard",
    props: { tone: card.tone, badge: card.badge },
  },
  styles: {},
  children: [],
}));

export const mockUiSpec: UISpec = {
  version: 1,
  name: "动感商品网格",
  viewport: { width: 1440, height: 900 },
  tokens: [],
  root: {
    id: "page",
    name: "电商 / 商品网格",
    type: "FRAME",
    semanticRole: "page",
    layout: {
      direction: "column",
      width: "fixed",
      height: "fixed",
      gap: { value: 48, variable: "spacing/2xl" },
      padding: {
        top: { value: 32, variable: "spacing/xl" },
        right: { value: 56, variable: "spacing/3xl" },
        bottom: { value: 48, variable: "spacing/2xl" },
        left: { value: 56, variable: "spacing/3xl" },
      },
    },
    styles: {
      fills: { value: "#f3f1ea", variable: "color/canvas" },
    },
    children: [
      {
        id: "header",
        name: "Header / Commerce",
        type: "INSTANCE",
        semanticRole: "header",
        layout: { direction: "row", width: "fill", height: "fixed" },
        component: {
          figmaComponent: "Header / Commerce",
          codeComponent: "Header",
          importPath: "@/components/Header",
          props: { theme: "light" },
        },
        styles: {},
        children: [],
      },
      {
        id: "intro",
        name: "区块标题",
        type: "FRAME",
        semanticRole: "section-intro",
        layout: {
          direction: "column",
          width: "fill",
          height: "hug",
          gap: { value: 12, variable: "spacing/md" },
        },
        styles: {},
        children: [
          {
            id: "eyebrow",
            name: "副标题",
            type: "TEXT",
            semanticRole: "label",
            layout: { direction: "none", width: "hug", height: "hug" },
            styles: {
              fontSize: { value: 12, variable: "typography/label/font-size" },
              fills: { value: "#ef5b2a", variable: "color/accent" },
            },
            content: "全新系列 / 26FW",
            children: [],
          },
          {
            id: "title",
            name: "主标题",
            type: "TEXT",
            semanticRole: "heading",
            layout: { direction: "none", width: "hug", height: "hug" },
            styles: {
              fontSize: { value: 64, variable: "typography/display/font-size" },
              fills: { value: "#171713", variable: "color/ink" },
            },
            content: "为运动而生的设计。",
            children: [],
          },
        ],
      },
      {
        id: "grid",
        name: "四列商品网格",
        type: "FRAME",
        semanticRole: "product-grid",
        layout: {
          direction: "grid",
          width: "fill",
          height: "hug",
          gap: { value: 20, variable: "spacing/lg" },
        },
        styles: {},
        children: cardNodes,
      },
    ],
  },
};

export const mockMappings: ComponentMapping[] = [
  {
    nodeId: "header",
    figmaComponent: "Header / Commerce",
    codeComponent: "Header",
    importPath: "@/components/Header",
    props: { theme: "light" },
    confidence: 0.96,
    status: "accepted",
    evidence: [
      "Figma 组件名称精确匹配",
      "Props 1 项按原样透传，未做兼容性校验",
      "导入路径来自固定 SDS Registry",
    ],
  },
  ...cards.map<ComponentMapping>((card) => ({
    nodeId: card.id,
    figmaComponent: "Product Card / Default",
    codeComponent: "ProductCard",
    importPath: "@/components/ProductCard",
    props: { tone: card.tone, badge: card.badge },
    confidence: 0.96,
    status: "accepted",
    evidence: [
      "Figma 组件名称精确匹配",
      "Props 2 项按原样透传，未做兼容性校验",
      "导入路径来自固定 SDS Registry",
    ],
  })),
];
