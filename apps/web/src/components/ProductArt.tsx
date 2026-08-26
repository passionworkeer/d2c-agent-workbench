import type { CSSProperties, ReactElement } from "react";

// 商品卡内嵌的产品剪影 SVG：演示 mock 不接真实图片资源，靠这四张风格化 SVG 让
// 「生成的设计稿」有可识别的商品视觉。每个图都按 tone 派生主色，保证卡片背景与
// 产品图配色一致。

export type ProductTone = "cobalt" | "coral" | "lime" | "charcoal";

interface ProductArtProps {
  tone: ProductTone;
  className?: string;
  style?: CSSProperties;
}

// 跑鞋：侧视剪影 + 鞋底分层 + 鞋舌
function RunningShoeArt({ className, style }: { className?: string; style?: CSSProperties }): ReactElement {
  return (
    <svg className={className} style={style} viewBox="0 0 200 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* 鞋底 */}
      <path d="M14 92 Q18 84 28 82 L170 80 Q186 80 188 92 Q188 100 178 102 L24 104 Q12 104 14 92 Z" fill="currentColor" opacity="0.92" />
      {/* 鞋面主轮廓 */}
      <path d="M28 82 Q34 60 60 50 L94 42 Q108 38 122 42 L156 52 Q172 58 178 72 L180 82 Z" fill="currentColor" />
      {/* 鞋舌 */}
      <path d="M88 42 Q92 30 104 30 L120 32 Q126 34 124 44 L122 52 Q108 50 96 50 Z" fill="currentColor" opacity="0.75" />
      {/* 鞋面缝线 */}
      <path d="M58 76 Q82 64 110 60 L150 64" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.35" />
      {/* 鞋眼 */}
      <circle cx="72" cy="60" r="2.4" fill="currentColor" opacity="0.5" />
      <circle cx="86" cy="56" r="2.4" fill="currentColor" opacity="0.5" />
      <circle cx="100" cy="52" r="2.4" fill="currentColor" opacity="0.5" />
      {/* 鞋底纹路 */}
      <path d="M40 96 L50 96 M70 96 L82 96 M104 96 L118 96 M142 96 L158 96" stroke="currentColor" strokeWidth="2" opacity="0.35" />
      {/* 高光 */}
      <path d="M62 56 Q90 44 118 46" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.4" />
    </svg>
  );
}

// 手袋：托特包剪影 + 提手 + 包身分隔
function HandbagArt({ className, style }: { className?: string; style?: CSSProperties }): ReactElement {
  return (
    <svg className={className} style={style} viewBox="0 0 200 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* 提手 */}
      <path d="M62 28 Q62 12 100 12 Q138 12 138 28" stroke="currentColor" strokeWidth="5" fill="none" strokeLinecap="round" />
      {/* 包身 */}
      <path d="M40 36 Q40 30 48 30 L152 30 Q160 30 160 36 L168 100 Q168 108 160 108 L40 108 Q32 108 32 100 Z" fill="currentColor" />
      {/* 包盖接缝 */}
      <path d="M40 56 L160 56" stroke="currentColor" strokeWidth="1.5" opacity="0.35" />
      {/* 中心装饰扣 */}
      <rect x="92" y="64" width="16" height="10" rx="2" fill="currentColor" opacity="0.55" />
      {/* 包侧纹理 */}
      <path d="M50 78 L150 78 M50 92 L150 92" stroke="currentColor" strokeWidth="1.2" opacity="0.3" />
      {/* 提手阴影 */}
      <path d="M64 32 Q66 22 78 20" stroke="currentColor" strokeWidth="3" fill="none" opacity="0.4" />
    </svg>
  );
}

// 外套：连帽外套正面剪影 + 拉链 + 口袋
function JacketArt({ className, style }: { className?: string; style?: CSSProperties }): ReactElement {
  return (
    <svg className={className} style={style} viewBox="0 0 200 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* 帽子 */}
      <path d="M70 22 Q100 8 130 22 Q126 30 118 32 L82 32 Q74 30 70 22 Z" fill="currentColor" />
      {/* 衣身 */}
      <path d="M58 34 Q60 30 66 30 L84 32 L100 40 L116 32 L134 30 Q140 30 142 34 L162 56 Q166 62 162 66 L156 70 L156 110 Q156 114 152 114 L48 114 Q44 114 44 110 L44 70 L38 66 Q34 62 38 56 Z" fill="currentColor" />
      {/* 中央拉链 */}
      <path d="M100 40 L100 114" stroke="currentColor" strokeWidth="2" opacity="0.4" />
      {/* 拉链头 */}
      <rect x="96" y="46" width="8" height="6" rx="1" fill="currentColor" opacity="0.6" />
      {/* 帽子接缝 */}
      <path d="M82 32 Q100 28 118 32" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.4" />
      {/* 口袋 */}
      <path d="M58 86 L86 86 L86 110 L58 110 Z M114 86 L142 86 L142 110 L114 110 Z" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.35" />
      {/* 袖口 */}
      <path d="M44 80 L44 110" stroke="currentColor" strokeWidth="1.5" opacity="0.35" />
      <path d="M156 80 L156 110" stroke="currentColor" strokeWidth="1.5" opacity="0.35" />
    </svg>
  );
}

// 帽子：棒球帽侧视 + 帽檐 + 帽冠拼接
function HatArt({ className, style }: { className?: string; style?: CSSProperties }): ReactElement {
  return (
    <svg className={className} style={style} viewBox="0 0 200 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* 帽冠 */}
      <path d="M48 70 Q48 24 116 22 Q150 22 156 48 L158 72 Z" fill="currentColor" />
      {/* 帽檐 */}
      <path d="M28 72 Q28 86 60 92 L172 92 Q186 88 184 76 Q182 68 168 68 L42 68 Q30 68 28 72 Z" fill="currentColor" opacity="0.85" />
      {/* 帽冠拼接线 */}
      <path d="M116 22 Q124 44 158 70" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.4" />
      {/* 帽眼 */}
      <circle cx="84" cy="48" r="2.5" fill="currentColor" opacity="0.45" />
      <circle cx="100" cy="42" r="2.5" fill="currentColor" opacity="0.45" />
      <circle cx="118" cy="38" r="2.5" fill="currentColor" opacity="0.45" />
      {/* 帽檐高光 */}
      <path d="M58 84 L150 84" stroke="currentColor" strokeWidth="1.5" opacity="0.35" />
    </svg>
  );
}

export function ProductArt({ tone, className, style }: ProductArtProps): ReactElement {
  const shared = { className, style };
  switch (tone) {
    case "cobalt":
      return <RunningShoeArt {...shared} />;
    case "coral":
      return <HandbagArt {...shared} />;
    case "lime":
      return <JacketArt {...shared} />;
    case "charcoal":
      return <HatArt {...shared} />;
    default:
      return <RunningShoeArt {...shared} />;
  }
}
