import figma from "@figma/code-connect";
import { Input } from "./Input";

// Figma 组件名对照（asset-indexer 解析此声明）：
export const figmaComponentNames = ["Input / Text", "Input"];

figma.connect(Input, figma.node("input-text"), {
  variantProps: { state: ["default", "error"] },
});
