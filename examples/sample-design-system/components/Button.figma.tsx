import figma from "@figma/code-connect";
import { Button } from "./Button";

// Figma 组件名对照（asset-indexer 解析此声明）：
export const figmaComponentNames = ["Button / Primary", "Button / Secondary", "Button"];

figma.connect(Button, figma.node("button-primary"), {
  variantProps: { variant: ["primary", "secondary"] },
});
