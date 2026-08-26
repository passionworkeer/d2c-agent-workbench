import figma from "@figma/code-connect";
import { Badge } from "./Badge";

// Figma 组件名对照（asset-indexer 解析此声明）：
export const figmaComponentNames = ["Badge / Default", "Badge"];

figma.connect(Badge, figma.node("badge-default"), {
  variantProps: { tone: ["coral", "lime", "cobalt", "charcoal"] },
});
