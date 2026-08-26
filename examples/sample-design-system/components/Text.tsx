import type { ReactNode } from "react";

/** SDS 文本：三档字号阶梯，对应 Figma「Text / Body」。 */
export interface TextProps {
  /** 字号阶梯：display（大标题）/ label（眉标）/ body（正文） */
  size: "display" | "label" | "body";
  children?: ReactNode;
}

export function Text({ size, children }: TextProps) {
  return <p className={`sds-text size-${size}`}>{children}</p>;
}
