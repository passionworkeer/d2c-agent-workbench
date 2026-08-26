import type { InputHTMLAttributes, ReactNode } from "react";

/** SDS 输入框：标签 + 提示文案 + 错误态，对应 Figma「Input / Text」。 */
export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** 输入框状态：error 态描红并显示 hint */
  state?: "default" | "error";
  /** 输入框标签 */
  label: ReactNode;
  /** 标签下方提示文案（error 态展示为危险色） */
  hint?: ReactNode;
}

export function Input({ state = "default", label, hint, ...rest }: InputProps) {
  return (
    <label className={`sds-input state-${state}`}>
      <span className="sds-input__label">{label}</span>
      <input className="sds-input__field" {...rest} />
      {hint ? <span className="sds-input__hint">{hint}</span> : null}
    </label>
  );
}
