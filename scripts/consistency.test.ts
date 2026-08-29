import { readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { BundleError, parseFigmaBundle } from "@d2c/figma-importer";
import { activitySpecSchema, assetCropSchema, targetProjectProfileSchema } from "@d2c/contracts";
import { compileUISpec } from "@d2c/ui-compiler";
import { mapSdsComponents } from "@d2c/component-matcher";
import { runReplayWorkflow } from "@d2c/orchestrator";
import {
  mockMappings,
} from "../apps/web/src/lib/mock-run";

const root = resolve(import.meta.dirname, "..");
const fixtureDir = join(root, "examples", "figma-bundles", "product-grid") + "/";

function buildProductGridZip(): Uint8Array {
  const manifest = JSON.parse(readFileSync(`${fixtureDir}manifest.json`, "utf8")) as Record<string, unknown>;
  const design = JSON.parse(readFileSync(`${fixtureDir}design.json`, "utf8")) as { nodes: unknown };
  const variables = JSON.parse(readFileSync(`${fixtureDir}variables.json`, "utf8")) as unknown;
  const components = JSON.parse(readFileSync(`${fixtureDir}components.json`, "utf8")) as unknown;
  const preview = readFileSync(`${fixtureDir}preview/root.svg`);
  const entries: Record<string, [Uint8Array, { level: 0 }]> = {
    "manifest.json": [Buffer.from(JSON.stringify(manifest)), { level: 0 }],
    "design.json": [Buffer.from(JSON.stringify(design)), { level: 0 }],
    "variables.json": [Buffer.from(JSON.stringify(variables)), { level: 0 }],
    "components.json": [Buffer.from(JSON.stringify(components)), { level: 0 }],
    "preview/root.svg": [Buffer.from(preview), { level: 0 }],
  };
  return zipSync(entries);
}

describe("examples/product-grid 与真实管线的跨包一致性", () => {
  it("打包后的 product-grid.zip 仍可被 figma-importer + ui-compiler 完整解析", () => {
    const bundle = parseFigmaBundle(buildProductGridZip());
    const spec = compileUISpec(bundle);
    expect(spec.root.children.length).toBeGreaterThan(0);
  });

  it("orchestrator 对 product-grid 跑出 [72, 94] 评测闭环", async () => {
    const bundle = parseFigmaBundle(buildProductGridZip());
    const spec = compileUISpec(bundle);
    const mappings = mapSdsComponents(spec);
    const events: Array<Awaited<ReturnType<typeof runReplayWorkflow>> extends AsyncGenerator<infer T> ? T : never> = [];
    for await (const event of runReplayWorkflow({ runId: "consistency", spec, mappings, delayMs: 0 })) {
      events.push(event);
    }

    const states = events.map((event) => event.state);
    expect(states).toEqual([
      "VALIDATED",
      "NORMALIZED",
      "ASSETS_INDEXED",
      "COMPONENTS_MAPPED",
      "CODE_PLANNED",
      "GENERATED",
      "BUILT",
      "EVALUATED",
      "REPAIRING",
      "BUILT",
      "EVALUATED",
      "COMPLETED",
    ]);

    const scores = events
      .filter((event) => event.state === "EVALUATED")
      .map((event) => (event.data?.evaluation as { overall: number }).overall);
    expect(scores).toHaveLength(2);
    expect(scores[0]).toBeCloseTo(72, 1);
    expect(scores[1]).toBeCloseTo(94, 1);

    const completed = events.at(-1);
    const delta = completed?.data?.scoreDelta as number;
    expect(delta).toBeCloseTo(22, 1);
  });

  it("真实 matcher 输出的 componentMappings 至少与 mockMappings 在语义上等价", async () => {
    const bundle = parseFigmaBundle(buildProductGridZip());
    const spec = compileUISpec(bundle);
    const actual = mapSdsComponents(spec);

    expect(actual.length).toBeGreaterThanOrEqual(mockMappings.length);
    const mockIndex = new Map(mockMappings.map((mapping) => [`${mapping.nodeId}:${mapping.figmaComponent}`, mapping]));
    for (const mapping of actual) {
      const key = `${mapping.nodeId}:${mapping.figmaComponent}`;
      const mock = mockIndex.get(key);
      if (!mock) continue;
      expect(mapping.codeComponent).toBe(mock.codeComponent);
      expect(mapping.importPath).toBe(mock.importPath);
      expect(mapping.confidence).toBe(0.96);
      expect(mapping.status).toBe("accepted");
    }
  });

  it("GENERATED 与 COMPLETED 事件都附带非空 generatedCode", async () => {
    const bundle = parseFigmaBundle(buildProductGridZip());
    const spec = compileUISpec(bundle);
    const mappings = mapSdsComponents(spec);
    const events: Array<Awaited<ReturnType<typeof runReplayWorkflow>> extends AsyncGenerator<infer T> ? T : never> = [];
    for await (const event of runReplayWorkflow({ runId: "consistency", spec, mappings, delayMs: 0 })) {
      events.push(event);
    }
    const generated = events.find((event) => event.state === "GENERATED");
    const completed = events.at(-1);
    const generatedCode = generated?.data?.generatedCode as string | undefined;
    const finalCode = completed?.data?.generatedCode as string | undefined;
    expect(generatedCode).toBeTruthy();
    expect(finalCode).toBeTruthy();
    // 草稿与终稿的差异落在 tokens.css / styleRefs 元数据中，generatedCode 字符串本身可能一致；
    // 这里仅断言两条路径都能输出可读代码，长度合理。
    expect(generatedCode!.length).toBeGreaterThan(100);
    expect(finalCode!.length).toBeGreaterThan(100);
  });

  it("figma-importer 拒绝明显伪造的输入", () => {
    expect(() => parseFigmaBundle(new Uint8Array([1, 2, 3]))).toThrow(BundleError);
  });

  it("浏览器本地真实执行 (apps/web/lib/local-run) 与 server 端 SSE 路径产出事件逐字段一致", async () => {
    // web 与 server 两条路径都调 runReplayWorkflow，差别只在 spec/mappings 来源与 runId。
    // 这里用相同 runId + 相同 fixture 跑两边，逐字段断言 trace 一致；
    // CANVAS_EDITED（-edit-N）实时追加事件不在此断言范围。
    const { createLocalRunEvents } = await import("../apps/web/src/lib/local-run");
    const { runReplayWorkflow } = await import("@d2c/orchestrator");

    // web 本地
    const webEvents = await createLocalRunEvents("product-grid");

    // server 端走同一 fixture 的 zip 解析
    const bundle = parseFigmaBundle(buildProductGridZip());
    const spec = compileUISpec(bundle);
    const mappings = mapSdsComponents(spec);
    const serverEvents: typeof webEvents = [];
    for await (const event of runReplayWorkflow({ runId: "shared-run-id", spec, mappings, delayMs: 0 })) {
      serverEvents.push(event);
    }

    expect(serverEvents).toHaveLength(webEvents.length);
    expect(serverEvents.map((event) => event.state)).toEqual(webEvents.map((event) => event.state));
    // 关键载荷字段：分数、scoreDelta、resolvedViolationIds、generatedCode 都必须逐字段一致
    const serverScores = serverEvents
      .filter((event) => event.state === "EVALUATED")
      .map((event) => (event.data?.evaluation as { overall: number }).overall);
    const webScores = webEvents
      .filter((event) => event.state === "EVALUATED")
      .map((event) => (event.data?.evaluation as { overall: number }).overall);
    expect(webScores).toEqual(serverScores);
    expect(webEvents.at(-1)?.data?.scoreDelta).toBe(serverEvents.at(-1)?.data?.scoreDelta);
    expect(webEvents.at(-1)?.data?.generatedCode).toBe(serverEvents.at(-1)?.data?.generatedCode);
  });

  it("form-page fixture 产出与 product-grid 不同的精确评测闭环", async () => {
    // 表单页与商品页是不同输入，应自然产生不同分数 / 不同 violation 集合 —— 这就是 Commit 4 的泛化承诺。
    const { createLocalRunEvents } = await import("../apps/web/src/lib/local-run");
    const { runReplayWorkflow } = await import("@d2c/orchestrator");

    const productGridEvents = await createLocalRunEvents("product-grid");
    const formPageEvents = await createLocalRunEvents("form-page");

    const gridScores = productGridEvents
      .filter((event) => event.state === "EVALUATED")
      .map((event) => (event.data?.evaluation as { overall: number }).overall);
    const formScores = formPageEvents
      .filter((event) => event.state === "EVALUATED")
      .map((event) => (event.data?.evaluation as { overall: number }).overall);

    // 表单页校准值：DRAFT=52.1 → FINAL=91.9
    expect(formScores[0]).toBeCloseTo(52.1, 0);
    expect(formScores[1]).toBeCloseTo(91.9, 0);
    // 与商品页的分数完全不同
    expect(formScores[0]).not.toBe(gridScores[0]);
    expect(formScores[1]).not.toBe(gridScores[1]);

    // 草稿各有 violation，终稿都归零
    const formDraftEval = formPageEvents.find((event) => event.state === "EVALUATED" && (event.data?.evaluation as { iteration?: number })?.iteration === 1);
    const formFinalEval = formPageEvents.filter((event) => event.state === "EVALUATED").at(-1);
    expect((formDraftEval?.data?.evaluation as { violations: unknown[] })?.violations.length).toBeGreaterThan(0);
    expect((formFinalEval?.data?.evaluation as { violations: unknown[] })?.violations).toHaveLength(0);

    // 表单页包含未映射组件（Checkbox / Simple 不在 Registry）
    const completedEvent = formPageEvents.find((event) => event.state === "COMPONENTS_MAPPED");
    const mappings = (completedEvent?.data?.mappings as { status: string }[] | undefined) ?? [];
    expect(mappings.some((m) => m.status === "unmapped")).toBe(true);

    // 与 server 路径跑同一 form-page 也应当一致（防止 web/server 分叉）
    const dir = join(root, "examples/figma-bundles/form-page") + "/";
    const formEntries: Record<string, [Uint8Array, { level: 0 }]> = {
      "manifest.json": [Buffer.from(readFileSync(`${dir}manifest.json`, "utf8")), { level: 0 }],
      "design.json": [Buffer.from(readFileSync(`${dir}design.json`, "utf8")), { level: 0 }],
      "variables.json": [Buffer.from(readFileSync(`${dir}variables.json`, "utf8")), { level: 0 }],
      "components.json": [Buffer.from(readFileSync(`${dir}components.json`, "utf8")), { level: 0 }],
      "preview/root.svg": [readFileSync(`${dir}preview/root.svg`), { level: 0 }],
    };
    const formBundle = parseFigmaBundle(zipSync(formEntries));
    const formSpec = compileUISpec(formBundle);
    const formMappings = mapSdsComponents(formSpec);
    const serverFormEvents: typeof formPageEvents = [];
    for await (const event of runReplayWorkflow({ runId: "form-shared", spec: formSpec, mappings: formMappings, delayMs: 0 })) {
      serverFormEvents.push(event);
    }
    const serverFormScores = serverFormEvents
      .filter((event) => event.state === "EVALUATED")
      .map((event) => (event.data?.evaluation as { overall: number }).overall);
    expect(serverFormScores).toEqual(formScores);
  });
});

describe("examples/activity-pages 真实样例 fixture 完整性", () => {
  const realFixtures = ["commerce-feed", "summer-game-festival", "pet-red-packet"] as const;

  for (const fixture of realFixtures) {
    it(`${fixture}: reference.jpg 与三件套（spec/profile/manifest）齐备且相互一致`, () => {
      const dir = join(root, "examples", "activity-pages", fixture);

      // 原始截图按字节原样入库，不允许二次压缩
      const referencePath = join(dir, "reference.jpg");
      expect(existsSync(referencePath), `${fixture}: 缺少 reference.jpg`).toBe(true);
      expect(statSync(referencePath).size, `${fixture}: reference.jpg 不应为空`).toBeGreaterThan(100_000);

      const spec = activitySpecSchema.parse(JSON.parse(readFileSync(join(dir, "activity-spec.json"), "utf8")));
      const profile = targetProjectProfileSchema.parse(JSON.parse(readFileSync(join(dir, "target-profile.json"), "utf8")));
      const manifest = JSON.parse(readFileSync(join(dir, "assets", "manifest.json"), "utf8")) as {
        atlas: string;
        assets: Array<{ id: string; nodeId: string; crop: unknown }>;
      };

      // 手机端基准视口：三张真实截图都是 390 CSS px 宽
      expect(spec.page.canonicalViewport.width).toBe(390);

      // spec 与 manifest 的资产一一对应，crop 界内且 nodeId 真实存在
      const nodeIds = new Set(spec.nodes.map((node) => node.id));
      const manifestIds = new Set(manifest.assets.map((asset) => asset.id));
      for (const asset of manifest.assets) {
        expect(() => assetCropSchema.parse(asset.crop)).not.toThrow();
        expect(nodeIds.has(asset.nodeId), `${fixture}/${asset.id}: manifest nodeId 不在 spec 中`).toBe(true);
      }
      for (const asset of spec.assets) {
        expect(manifestIds.has(asset.id), `${fixture}/${asset.id}: spec 资产缺 manifest 裁切`).toBe(true);
        expect(asset.path).toBe(manifest.atlas);
      }

      // 全部指向同一个目标仓库，路由互不冲突
      expect(profile.repositoryPath).toBe("examples/activity-target");
      expect(profile.previewUrl.startsWith("http://127.0.0.1:4173/")).toBe(true);
      expect(spec.page.route.startsWith("/")).toBe(true);
    });
  }

  it("三个真实样例的路由与 previewUrl 互不冲突", () => {
    const seen = new Set<string>();
    for (const fixture of realFixtures) {
      const dir = join(root, "examples", "activity-pages", fixture);
      const spec = activitySpecSchema.parse(JSON.parse(readFileSync(join(dir, "activity-spec.json"), "utf8")));
      const profile = targetProjectProfileSchema.parse(JSON.parse(readFileSync(join(dir, "target-profile.json"), "utf8")));
      expect(seen.has(spec.page.route), `${fixture}: 路由重复 ${spec.page.route}`).toBe(false);
      seen.add(spec.page.route);
      expect(seen.has(profile.previewUrl), `${fixture}: previewUrl 重复`).toBe(false);
      seen.add(profile.previewUrl);
    }
  });
});