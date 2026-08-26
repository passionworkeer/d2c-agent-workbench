import figma from "@figma/code-connect";
import { ProductCard } from "./ProductCard";

// Figma 组件名对照（asset-indexer 解析此声明，matcher 据此把 INSTANCE 节点映射到本组件）：
export const figmaComponentNames = ["Product Card / Default", "Product Card"];

figma.connect(ProductCard, figma.node("product-card-default"), {
  variantProps: { tone: ["coral", "lime", "cobalt", "charcoal"] },
});
