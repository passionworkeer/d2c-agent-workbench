import figma from "@figma/code-connect";
import { Text } from "./Text";

// Figma 组件名对照（asset-indexer 解析此声明）：
export const figmaComponentNames = ["Text / Body", "Text"];

figma.connect(Text, figma.node("text-body"), {
  variantProps: { size: ["display", "label", "body"] },
});
