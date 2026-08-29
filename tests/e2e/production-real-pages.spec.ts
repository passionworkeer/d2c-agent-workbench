import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

// 三张真实移动活动页（手机截图混合重建）的完整生产闭环验收：
// UI 跑闭环到 COMPLETED → 终分达到服务端声明的验收门槛（70：照片重采样 + 语义重建
// 导航的像素对比天花板实测 75-80 分）→ mobile 视口零横向溢出 → 语义评审标注证据来源；
// 再从服务端落盘的 run.json 回读 runId，用渲染 Artifact 的真实视口几何逐块对照
// 服务端注册的 referenceNodes 保真契约（评测 layoutGeometry 用同一集合）——
// 「390px 整页高保真」不是口头承诺，是可复核的数字。
//
// 真实样例复用同一目标仓库骨架，但每个 run 独立工作区（含依赖安装），整体放宽到 7 分钟。

interface SourceBox { x: number; y: number; width: number; height: number }

interface RenderedNodeGeometry extends SourceBox { visible: boolean }

interface RenderedViewport {
  name: string;
  width: number;
  height: number;
  horizontalOverflow: boolean;
  nodes: Record<string, RenderedNodeGeometry>;
}

interface RunRecord {
  run?: { id?: string; createdAt?: string; status?: string };
  sampleId?: string;
  events?: Array<{ state?: string; data?: { artifactId?: unknown } }>;
}

interface RunDetail {
  events: Array<{ state: string; data?: { artifactId?: unknown } }>;
  /** 服务端注册的保真契约：块级 referenceNodes（评测 layoutGeometry 用同一集合） */
  referenceNodes?: Record<string, SourceBox>;
}

const RUNS_DIRECTORY = join(process.cwd(), "apps/server/.data/production/runs");
const FIXTURE_DIRECTORY = join(process.cwd(), "examples/activity-pages");
const TERMINAL_STATES = new Set(["COMPLETED", "FAILED", "NEEDS_REVIEW"]);

const REAL_SAMPLES = [
  { sampleId: "commerce-feed", chip: /快手商城/ },
  { sampleId: "summer-game-festival", chip: /夏日游戏节/ },
  { sampleId: "pet-red-packet", chip: /养萌宠红包/ },
] as const;

// 相对 3% 容差，另给小节点 2px 绝对下限（字号渲染的亚像素差异不至于误报）
const withinTolerance = (actual: number, expected: number) =>
  Math.abs(actual - expected) <= Math.max(expected * 0.03, 2);

async function readRunRecords(): Promise<RunRecord[]> {
  const records: RunRecord[] = [];
  let entries: Array<{ name: string; isDirectory: () => boolean }>;
  try {
    entries = await readdir(RUNS_DIRECTORY, { withFileTypes: true }) as Array<{ name: string; isDirectory: () => boolean }>;
  } catch {
    return records;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      records.push(JSON.parse(await readFile(join(RUNS_DIRECTORY, entry.name, "run.json"), "utf8")) as RunRecord);
    } catch {
      // 写入中的临时文件或不完整的 run.json：跳过
    }
  }
  return records;
}

/** 轮询磁盘取该样例最新的终态 run（run.json 落盘是异步的，UI COMPLETED 后可能仍差一拍） */
async function findLatestCompletedRun(sampleId: string): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const records = (await readRunRecords())
      .filter((record) => record.sampleId === sampleId)
      .filter((record) => record.events?.some((event) => TERMINAL_STATES.has(String(event.state))));
    const latest = records.sort((a, b) => String(a.run?.createdAt ?? "").localeCompare(String(b.run?.createdAt ?? ""))).at(-1);
    if (latest?.run?.id) return latest.run.id;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`没有找到 ${sampleId} 的终态 run 记录`);
}

test("real mobile activity pages complete the production loop with 390px fidelity", async ({ page }) => {
  test.setTimeout(420_000);

  const canonicalBySample = new Map<string, { width: number; height: number }>();
  for (const { sampleId } of REAL_SAMPLES) {
    const spec = JSON.parse(await readFile(join(FIXTURE_DIRECTORY, sampleId, "activity-spec.json"), "utf8")) as {
      page: { canonicalViewport: { width: number; height: number } };
    };
    canonicalBySample.set(sampleId, spec.page.canonicalViewport);
  }

  for (const { sampleId, chip } of REAL_SAMPLES) {
    await page.goto("/");
    await page.getByRole("button", { name: /活动页生产/ }).click();
    await page.getByRole("button", { name: "载入黄金样例" }).click();
    await page.getByRole("button", { name: chip }).click();
    await expect(page.getByTestId("production-sample")).toContainText("390px 手机端 · 高保真整页还原");

    await page.getByRole("button", { name: "运行生产闭环" }).click();
    await expect(page.getByText("真实构建通过").first()).toBeVisible({ timeout: 300_000 });
    await expect(page.getByText("COMPLETED")).toBeVisible({ timeout: 300_000 });

    // 终分达到服务端声明门槛（≥70）且没有任何视口横向溢出（P1 硬门槛）
    await expect(page.getByTestId("production-final-score")).toHaveText(/(7\d|8\d|9\d|100)/, { timeout: 60_000 });
    await expect(page.getByText("responsive_error")).toHaveCount(0);
    // 语义评审必须标注证据来源：MiniMax 实时评审或黄金基准回退，缺证据即 P1
    await expect(page.getByTestId("semantic-provider")).toContainText(/MiniMax 实时评审|黄金基准回退/);

    // —— 服务端侧复核：run.json 找 runId → 最后一次渲染 Artifact 的视口几何对照 spec ——
    const runId = await findLatestCompletedRun(sampleId);
    const detailResponse = await page.request.get(`/api/production/runs/${runId}`);
    expect(detailResponse.ok()).toBe(true);
    const detail = await detailResponse.json() as RunDetail;
    const rendered = detail.events.filter((event) => event.state === "RENDERED").at(-1);
    const renderArtifactId = String(rendered?.data?.artifactId);
    expect(renderArtifactId, `${sampleId}: 找不到 RENDERED 事件的 artifactId`).toMatch(/^artifact-/);

    const artifactResponse = await page.request.get(`/api/production/runs/${runId}/artifacts/${renderArtifactId}`);
    expect(artifactResponse.ok()).toBe(true);
    const artifact = await artifactResponse.json() as { content: { viewports: RenderedViewport[] } };
    const canonical = canonicalBySample.get(sampleId)!;

    const canonicalViewport = artifact.content.viewports.find((viewport) =>
      viewport.width === canonical.width && viewport.height === canonical.height);
    expect(canonicalViewport, `${sampleId}: 缺少 ${canonical.width}x${canonical.height} 的 canonical 视口`).toBeTruthy();

    // 任一视口都不得横向溢出
    for (const viewport of artifact.content.viewports) {
      expect(viewport.horizontalOverflow, `${sampleId}/${viewport.name}: 横向溢出`).toBe(false);
    }

    // 整页还原：page 根节点的盒子就是 390px 宽、页高贴近 canonical 高度
    const pageNode = canonicalViewport!.nodes["page"];
    expect(pageNode, `${sampleId}: 渲染结果缺 page 节点`).toBeTruthy();
    expect(withinTolerance(pageNode!.width, canonical.width), `${sampleId}: page 宽 ${pageNode!.width} ≠ ${canonical.width}`).toBe(true);
    expect(withinTolerance(pageNode!.height, canonical.height), `${sampleId}: page 高 ${pageNode!.height} ≠ ${canonical.height}`).toBe(true);

    // 块级保真契约逐项对照：referenceNodes 是服务端注册的验收集合（评测 layoutGeometry
    // 用同一集合）。文本级节点的字体度量/亚像素差异不在逐项几何对照范围——语义重建
    // 与截图字体栅格天然不同，内容由 textConsistency 逐项对比、视觉由像素 diff 把关。
    const referenceNodes = detail.referenceNodes ?? {};
    expect(Object.keys(referenceNodes).length, `${sampleId}: run 缺少 referenceNodes`).toBeGreaterThan(0);
    const compared: string[] = [];
    for (const [nodeId, expectedBox] of Object.entries(referenceNodes)) {
      const renderedNode = canonicalViewport!.nodes[nodeId];
      expect(renderedNode, `${sampleId}: 渲染结果缺 ${nodeId} 节点`).toBeTruthy();
      expect(renderedNode!.visible, `${sampleId}/${nodeId}: 节点不可见`).toBe(true);
      for (const key of ["x", "y", "width", "height"] as const) {
        expect(
          withinTolerance(renderedNode![key], expectedBox[key]),
          `${sampleId}/${nodeId}.${key}: 渲染 ${renderedNode![key]} vs 契约 ${expectedBox[key]}`,
        ).toBe(true);
      }
      compared.push(nodeId);
    }
    expect(compared.length, `${sampleId}: 对照的区块数不足`).toBeGreaterThanOrEqual(6);
  }
});
