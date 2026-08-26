import figma from "@figma/code-connect";
import { Header } from "./Header";

// Figma 组件名对照（asset-indexer 解析此声明）：
export const figmaComponentNames = ["Header / Commerce", "Header"];

figma.connect(Header, figma.node("header-commerce"), {
  variantProps: { theme: ["light", "dark"] },
});
