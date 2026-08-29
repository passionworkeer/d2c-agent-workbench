# 体验官招募 · 活动表单页 PRD（黄金样例 2）

## 页面信息

- 路由：`/campaign/summer-form`
- 画布：1440×900（桌面端优先）
- 主色：`color/accent = #ff5000`（目标仓库 Token）
- 与「夏日好物节」共用同一目标仓库骨架（`examples/activity-target`），验证不同页面结构走同一闭环

## 区块

### form-section（表单区，0,0,1440,640）

- 纵向 Flex，占满整行宽度，固定高 640px
- `form-title`（60,80,520,56）：**限时体验官招募 · 填写即领券**，40px / 700
- `form-body`（60,180,520,400）：纵向 Flex，gap 24，固定宽 520
  - `field-name`：您的姓名（18px）
  - `field-phone`：手机号（用于发放奖励）（18px）
  - `submit-hint`：立即报名 · 100% 中奖（20px / 700，主色）

## 已知问题（与样例 1 同源）

目标仓库骨架 `padding-left: 48px` 使 form-section 首轮偏移 48px（P1），
定向修复只改生成的 CSS（margin-left/width），复评后对齐。

## 验收

- 首轮：form-section 几何误差 ≈0.054 触发 P1，进入修复
- 修复后：回到 (0,0,1440,640)，终局分数 ≥90，COMPLETED
- 两个样例的违规 id（layout:hero vs layout:form-section）与分数独立，
  证明评分非硬编码
