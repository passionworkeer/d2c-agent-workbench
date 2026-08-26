import type { ButtonHTMLAttributes, ReactNode } from "react";

/** SDS 按钮：主/次双变体 + 两档尺寸，对应 Figma「Button / Primary」「Button / Secondary」。 */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 按钮变体 */
  variant: "primary" | "secondary";
  /** 尺寸 */
  size?: "sm" | "md";
  children?: ReactNode;
}

export function Button({ variant, size = "md", children, ...rest }: ButtonProps) {
  return (
    <button className={`sds-button variant-${variant} size-${size}`} {...rest}>
      {children}
    </button>
  );
}
