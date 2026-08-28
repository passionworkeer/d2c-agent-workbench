import { lazy, Suspense, type ComponentType } from "react";

// 动态收集生成的活动页模块：生成器把 CampaignPage.tsx 写进 src/pages/campaign/，
// 这里用 glob 拾取，目标仓库在页面生成前后都能通过 typecheck。
const pages = import.meta.glob("./pages/**/*.tsx");
const firstPage = Object.values(pages)[0] as (() => Promise<{ default: ComponentType }>) | undefined;
const CampaignPage = firstPage ? lazy(firstPage) : null;

export default function App() {
  return (
    // 黄金样例中已知的基线间距问题：骨架左内边距 48px 与参考稿 hero x=0 不一致。
    // 首轮评测应产生 hero 的 layout P1，局部修复只改 Campaign CSS 即可对齐。
    <div style={{ padding: "0 0 0 48px", minHeight: "100vh" }}>
      {CampaignPage ? (
        <Suspense fallback={null}>
          <CampaignPage />
        </Suspense>
      ) : (
        <p>等待活动页生成…</p>
      )}
    </div>
  );
}
