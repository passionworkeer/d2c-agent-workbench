# 夏日好物节 · 活动页 PRD（黄金样例）

## 页面信息

- 路由：`/campaign/summer`
- 画布：1440×900（桌面端优先，移动端 0–767 单列堆叠）
- 主色：`color/accent = #ff5000`（来自目标仓库 Token）

## 区块

### hero（主视觉，0,0,1440,500）

- 纵向 Flex，占满整行宽度（从 x=0 起），固定高 500px
- 标题 `hero-title`（40,40,600,72）：文案 **夏日好物节 · 全场 5 折**，48px / 700
- 说明：文案以此 PRD 为准；视觉/OCR 识别与之冲突时以 PRD 覆盖并记录 unresolved

## 已知问题（用于验证修复闭环）

目标仓库骨架（`examples/activity-target`）的页面容器带有 `padding-left: 48px`，
与参考稿 hero x=0 不一致。首轮评测应产出 `layout:hero` 的 P1 违规，
定向修复只允许修改生成的 Campaign CSS（margin-left/width），复评后对齐。

## 验收

- 首轮评测：hero 几何误差触发 P1，最终状态 `NEEDS_REVIEW` 进入修复
- 修复后：hero 回到 (0,0,1440,500)，终局分数 ≥ 90，状态 `COMPLETED`
- 修复仅触碰 1 个文件（CampaignPage.module.css），全程 Artifact 可追溯
