import type { ReactNode } from "react";

/** SDS 商品卡片：四色 tone 轮换 + 可选角标，对应 Figma「Product Card / Default」。 */
export interface ProductCardProps {
  /** 卡片配色（Figma variantProps tone） */
  tone: "coral" | "lime" | "cobalt" | "charcoal";
  /** 右上角角标文案，如「New」 */
  badge?: ReactNode;
  /** 卡片标题 */
  title?: ReactNode;
  /** 卡片正文 */
  children?: ReactNode;
}

export function ProductCard({ tone, badge, title, children }: ProductCardProps) {
  return (
    <article className={`sds-product-card tone-${tone}`}>
      {badge ? <span className="sds-product-card__badge">{badge}</span> : null}
      {title ? <h3 className="sds-product-card__title">{title}</h3> : null}
      <div className="sds-product-card__body">{children}</div>
    </article>
  );
}
