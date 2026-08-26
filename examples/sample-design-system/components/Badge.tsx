import type { ReactNode } from "react";

/** SDS 徽标：四色 tone，对应 Figma「Badge / Default」。 */
export interface BadgeProps {
  /** 徽标配色 */
  tone: "coral" | "lime" | "cobalt" | "charcoal";
  children?: ReactNode;
}

export function Badge({ tone, children }: BadgeProps) {
  return <span className={`sds-badge tone-${tone}`}>{children}</span>;
}
