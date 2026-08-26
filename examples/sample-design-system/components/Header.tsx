import type { ReactNode } from "react";

/** SDS 页头：明暗双主题 + 导航链接，对应 Figma「Header / Commerce」。 */
export interface HeaderProps {
  /** 页头主题 */
  theme: "light" | "dark";
  /** 右侧导航链接 */
  links?: Array<{ label: string; href: string }>;
  /** 品牌区文案 */
  brand?: ReactNode;
}

export function Header({ theme, links = [], brand = "SDS Store" }: HeaderProps) {
  return (
    <header className={`sds-header theme-${theme}`}>
      <span className="sds-header__brand">{brand}</span>
      <nav className="sds-header__nav">
        {links.map((link) => (
          <a key={link.href} href={link.href} className="sds-header__link">
            {link.label}
          </a>
        ))}
      </nav>
    </header>
  );
}
