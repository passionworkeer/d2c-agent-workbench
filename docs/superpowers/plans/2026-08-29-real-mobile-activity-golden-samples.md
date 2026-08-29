# Real Mobile Activity Golden Samples Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build three high-fidelity mobile activity golden samples with reusable enterprise React components, real MiniMax two-image semantic review, self-contained Figma bundles, and a working offline Figma import plugin.

**Architecture:** Each sample is a server-registered ActivitySpec whose root maps to a trusted page component in the target repository. The component renders stable D2C node IDs and uses the unchanged reference image as a crop atlas for complex artwork, while navigation, cards, tasks, buttons, and ordinary text remain semantic DOM. The production evaluator combines normalized full-page pixel diff with server-side MiniMax review; the same ActivitySpec and rendered geometry produce a self-contained Figma bundle imported by an offline plugin.

**Tech Stack:** TypeScript, React, CSS Modules, Fastify, Zod, Playwright, Jimp/looks-same, MiniMax Anthropic-compatible API, Figma Plugin API, Vitest, pnpm.

---

## File map

New sample fixtures:

- `examples/activity-pages/commerce-feed/*`: reference, PRD, spec, target profile, crop manifest, prebuilt Figma bundle.
- `examples/activity-pages/summer-game-festival/*`: same contract for the game-task page.
- `examples/activity-pages/pet-red-packet/*`: same contract for the pet-red-packet page.

Target repository:

- `examples/activity-target/src/components/activity/shared.tsx`: mobile shell, status bar, bottom navigation, artwork crop primitive.
- `examples/activity-target/src/components/activity/cards.tsx`: product, task, reward, progress, and action components.
- `examples/activity-target/src/components/activity/activity.module.css`: shared tokens and component styles.
- `examples/activity-target/src/components/activity/CommerceFeedExperience.tsx`: commerce page composition and local interaction.
- `examples/activity-target/src/components/activity/SummerGameFestivalExperience.tsx`: game page composition and local interaction.
- `examples/activity-target/src/components/activity/PetRedPacketExperience.tsx`: pet page composition and local interaction.
- `examples/activity-target/vite.config.ts`, `examples/activity-target/tsconfig.json`: `@/` alias used by trusted mappings.

Production pipeline:

- `apps/server/src/profiles.ts`: sample registrations, trusted component mappings, reference and asset roots.
- `apps/server/src/model-config.ts`: secret-safe MiniMax config loading.
- `apps/server/src/semantic-review.ts`: two-image tool call and schema validation.
- `apps/server/src/production.ts`: semantic adapter wiring and evidence persistence.
- `packages/orchestrator/src/production.ts`: semantic review adapter and EVALUATED evidence.
- `packages/evaluator/src/production.ts`: reference normalization and asset pHash derivation.
- `packages/codegen/src/production.ts`: composite mapping source locators.
- `apps/web/src/lib/production-api.ts`: three new sample payloads.
- `apps/web/src/components/ProductionWorkbench.tsx`: sample thumbnails and semantic evidence source.

Figma:

- `packages/figma-patcher/src/export.ts`: versioned self-contained assets and crop metadata.
- `apps/figma-importer-plugin/*`: offline JSON import UI and recursive Figma node builder.

Verification:

- Package tests next to each implementation file.
- `tests/e2e/production-real-pages.spec.ts`: all three real pages.
- `README.md`, `docs/demo-script.md`, and the activity production design checklist.

---

### Task 1: Define crop-manifest and semantic-review contracts

**Files:**
- Modify: `packages/contracts/src/production.ts`
- Modify: `packages/contracts/src/production.test.ts`

- [x] **Step 1: Write failing contract tests**

Add tests that parse a normalized atlas crop and semantic evidence, and reject crops outside `[0, 1]`:

```ts
expect(assetCropSchema.parse({ x: 0.1, y: 0.2, width: 0.3, height: 0.4 })).toEqual({
  x: 0.1, y: 0.2, width: 0.3, height: 0.4,
});
expect(() => assetCropSchema.parse({ x: 0.9, y: 0, width: 0.2, height: 1 })).toThrow();
expect(semanticReviewEvidenceSchema.parse({
  score: 94, layout: 96, content: 93, visualTone: 92, taskClarity: 95,
  summary: "主要结构一致", issues: [], provider: "minimax",
}).provider).toBe("minimax");
```

- [x] **Step 2: Run the tests and verify RED**

Run: `pnpm --filter @d2c/contracts test -- --run src/production.test.ts`

Expected: FAIL because both schemas are not exported.

- [x] **Step 3: Implement the schemas and types**

Add strict schemas:

```ts
export const assetCropSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().positive().max(1),
  height: z.number().positive().max(1),
}).strict().refine((crop) => crop.x + crop.width <= 1 && crop.y + crop.height <= 1, "crop must stay inside atlas");

export const semanticReviewEvidenceSchema = z.object({
  score: z.number().min(0).max(100),
  layout: z.number().min(0).max(100),
  content: z.number().min(0).max(100),
  visualTone: z.number().min(0).max(100),
  taskClarity: z.number().min(0).max(100),
  summary: z.string().min(1),
  issues: z.array(z.object({
    title: z.string().min(1),
    severity: z.enum(["P1", "P2", "P3"]),
    region: rectSchema.optional(),
  }).strict()).max(5),
  provider: z.enum(["minimax", "registered-fallback"]),
}).strict();
```

Export inferred `AssetCrop` and `SemanticReviewEvidence` types.

- [x] **Step 4: Run contract tests and typecheck**

Run: `pnpm --filter @d2c/contracts test && pnpm --filter @d2c/contracts typecheck`

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/contracts/src/production.ts packages/contracts/src/production.test.ts
git commit -m "feat(contracts): 增加素材裁切与语义评审协议"
```

### Task 2: Add three immutable fixtures and crop manifests

**Files:**
- Create: `examples/activity-pages/commerce-feed/reference.jpg`
- Create: `examples/activity-pages/commerce-feed/prd.md`
- Create: `examples/activity-pages/commerce-feed/activity-spec.json`
- Create: `examples/activity-pages/commerce-feed/target-profile.json`
- Create: `examples/activity-pages/commerce-feed/assets/manifest.json`
- Create equivalent five files for `summer-game-festival`
- Create equivalent five files for `pet-red-packet`
- Modify: `apps/web/src/lib/production-api.test.ts`
- Modify: `scripts/consistency.test.ts`

- [x] **Step 1: Write failing fixture tests**

Assert all five sample IDs exist, all ActivitySpecs parse, every crop is bounded, and each image node references a manifest asset:

```ts
expect(GOLDEN_SAMPLES.map((sample) => sample.id)).toEqual([
  "campaign", "summer-form", "commerce-feed", "summer-game-festival", "pet-red-packet",
]);
for (const fixture of realFixtures) {
  expect(activitySpecSchema.safeParse(fixture.spec).success).toBe(true);
  for (const entry of fixture.manifest.assets) assetCropSchema.parse(entry.crop);
  expect(new Set(fixture.spec.nodes.map((node) => node.id)).size).toBe(fixture.spec.nodes.length);
}
```

- [x] **Step 2: Run fixture tests and verify RED**

Run: `pnpm exec vitest run apps/web/src/lib/production-api.test.ts scripts/consistency.test.ts`

Expected: FAIL because the sample directories and registrations do not exist.

- [x] **Step 3: Copy original references unchanged**

Copy exactly:

```text
D:/Data/Downloads/cdbc11a350f9a2e20f00150fdbe0e5a8.jpg
  → examples/activity-pages/commerce-feed/reference.jpg
D:/Data/Downloads/17817eb52871da70f7d3ea06fadd7367.jpg
  → examples/activity-pages/summer-game-festival/reference.jpg
D:/Data/Downloads/eace84b3458bcc82e7bcc2260b54310a.jpg
  → examples/activity-pages/pet-red-packet/reference.jpg
```

Verify SHA-256 equality with `Get-FileHash` before continuing.

- [x] **Step 4: Author exact crop manifests**

Use normalized source-image coordinates. Each entry has stable ID, node ID, purpose, alt text, and bounded crop:

```json
{
  "version": "1.0",
  "atlas": "reference.jpg",
  "assets": [
    {
      "id": "hero-art",
      "nodeId": "hero-art",
      "purpose": "complex artwork",
      "alt": "活动主视觉",
      "crop": { "x": 0, "y": 0.04, "width": 1, "height": 0.28 }
    }
  ]
}
```

The final manifests use page-specific measured coordinates from the three supplied images rather than this generic example.

- [x] **Step 5: Author PRDs and complete ActivitySpecs**

Each spec uses a 390px canonical viewport, full node hierarchy, `reference.jpg` asset evidence, stable IDs, semantic text, and a trusted root component binding. The root follows this shape:

```json
{
  "id": "page",
  "role": "page",
  "name": "页面",
  "sourceBox": { "x": 0, "y": 0, "width": 390, "height": 867 },
  "layout": {
    "mode": "flow",
    "width": { "mode": "fill" },
    "height": { "mode": "fixed", "value": 867 },
    "overflow": "hidden",
    "rationale": "390px 手机完整长页"
  },
  "responsive": [{ "viewport": "mobile", "rule": "preserve" }],
  "visual": { "opacity": 1 },
  "tokenRefs": [],
  "evidence": [{ "type": "user", "sourceId": "reference", "observation": "人工校准黄金样例", "confidence": 1 }],
  "confidence": 1,
  "reviewState": "accepted",
  "children": ["status-bar", "top-nav", "content", "bottom-nav"]
}
```

- [x] **Step 6: Run fixture tests**

Run: `pnpm exec vitest run apps/web/src/lib/production-api.test.ts scripts/consistency.test.ts`

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add examples/activity-pages apps/web/src/lib/production-api.test.ts scripts/consistency.test.ts
git commit -m "test(fixtures): 增加三张真实移动活动页黄金样例"
```

### Task 3: Build the target repository activity component library

**Files:**
- Create: `examples/activity-target/src/components/activity/shared.tsx`
- Create: `examples/activity-target/src/components/activity/cards.tsx`
- Create: `examples/activity-target/src/components/activity/activity.module.css`
- Create: `examples/activity-target/src/components/activity/activity.test.tsx`
- Modify: `examples/activity-target/vite.config.ts`
- Modify: `examples/activity-target/tsconfig.json`
- Modify: `examples/activity-target/package.json`

- [x] **Step 1: Add failing component tests**

Use Vitest and Testing Library to verify stable IDs and real interaction state:

```tsx
render(<TaskCard nodeId="task-publish" title="发布作品" reward="+50 星钻" action="去发布" />);
expect(screen.getByTestId("task-publish")).toHaveAttribute("data-d2c-node-id", "task-publish");
await user.click(screen.getByRole("button", { name: "去发布" }));
expect(screen.getByRole("button", { name: "已完成" })).toBeDisabled();
```

- [x] **Step 2: Run target tests and verify RED**

Run: `pnpm --dir examples/activity-target test`

Expected: FAIL because the test script and components do not exist.

- [x] **Step 3: Add alias and test configuration**

Configure Vite and TypeScript:

```ts
resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
test: { environment: "jsdom", setupFiles: ["./src/test-setup.ts"] },
```

Add `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, and `@testing-library/jest-dom` as development dependencies.

- [x] **Step 4: Implement shared components**

`ArtworkSlice` renders the unchanged atlas through a clipped background:

```tsx
export function ArtworkSlice({ nodeId, src, crop, className, label }: ArtworkSliceProps) {
  const scaleX = 100 / crop.width;
  const scaleY = 100 / crop.height;
  return <div
    data-d2c-node-id={nodeId}
    role="img"
    aria-label={label}
    className={className}
    style={{
      backgroundImage: `url(${JSON.stringify(src).slice(1, -1)})`,
      backgroundSize: `${scaleX}% ${scaleY}%`,
      backgroundPosition: `${crop.x / (1 - crop.width || 1) * 100}% ${crop.y / (1 - crop.height || 1) * 100}%`,
    }}
  />;
}
```

Implement `MobileActivityShell`, `PhoneStatusBar`, `KwaiTopNavigation`, and `BottomTabBar` with semantic elements, button labels, keyboard support, and `data-d2c-node-id`.

- [x] **Step 5: Implement card components**

Create typed `ProductCard`, `TaskCard`, `RewardTile`, `ProgressCard`, `FloatingAction`, and `PrimaryActionButton`. All interactive controls are native buttons; decorative images use `ArtworkSlice`; all visible ordinary text remains DOM text.

- [x] **Step 6: Run target tests and build**

Run: `pnpm --dir examples/activity-target test && pnpm --dir examples/activity-target typecheck && pnpm --dir examples/activity-target build`

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add examples/activity-target
git commit -m "feat(target): 建立移动活动页企业组件库"
```

### Task 4: Handcraft the three high-fidelity page components

**Files:**
- Create: `examples/activity-target/src/components/activity/CommerceFeedExperience.tsx`
- Create: `examples/activity-target/src/components/activity/SummerGameFestivalExperience.tsx`
- Create: `examples/activity-target/src/components/activity/PetRedPacketExperience.tsx`
- Create: `examples/activity-target/src/components/activity/real-pages.module.css`
- Create: `examples/activity-target/src/components/activity/real-pages.test.tsx`

- [x] **Step 1: Add failing page behavior and structure tests**

```tsx
const pages = [
  [CommerceFeedExperience, ["commerce-search", "product-grid", "bottom-nav"]],
  [SummerGameFestivalExperience, ["festival-hero", "benefit-panel", "task-list"]],
  [PetRedPacketExperience, ["pet-stage", "level-progress", "feed-action"]],
] as const;
for (const [Page, ids] of pages) {
  render(<Page atlasUrl="/campaign/reference.jpg" data-d2c-ready="true" />);
  for (const id of ids) expect(document.querySelector(`[data-d2c-node-id="${id}"]`)).not.toBeNull();
}
```

Also assert search, task claim, and feed actions change visible local state.

- [x] **Step 2: Run tests and verify RED**

Run: `pnpm --dir examples/activity-target test -- --run real-pages.test.tsx`

Expected: FAIL because page components are missing.

- [x] **Step 3: Implement `CommerceFeedExperience`**

Compose status bar, top tabs, search, five quick actions, promo banner, two-column products, and bottom navigation. Use the page data below:

```ts
const products = [
  { id: "tissue", title: "【第三件0.01元】心相印抽纸", price: "3.01", badge: "品牌抽纸热销榜·第1名" },
  { id: "tea", title: "康师傅多口味混合任选整箱", price: "5.01", badge: "整箱装饮料热销榜·第6名" },
  { id: "detergent", title: "【爆品推荐】大师香氛洗衣液", price: "新人专享", badge: "先用后付" },
  { id: "comb", title: "迷你排骨梳镂空按摩梳子", price: "+100", badge: "再逛30秒" },
];
```

- [x] **Step 4: Implement `SummerGameFestivalExperience`**

Compose hero artwork, star balance, rule/backpack actions, collaboration tasks, benefits, reward cards, task list, and sticky activity tabs. Use local task state keyed by `task-install` and `task-follow`.

- [x] **Step 5: Implement `PetRedPacketExperience`**

Compose app navigation, title, income/progress card, stage artwork, floating actions, pet status, three CTAs, task section, and bottom navigation. Feeding decrements energy only when energy is positive; at zero it displays `能量不足` without negative values.

- [x] **Step 6: Implement measured mobile CSS**

Use a 390px design width and CSS variables:

```css
:root {
  --activity-width: 390px;
  --safe-bottom: 28px;
  --kwai-red: #ff1645;
  --festival-violet: #6f45ff;
  --pet-orange: #ff6319;
}
.activityPage { width: min(100vw, var(--activity-width)); min-height: 100%; margin: 0 auto; overflow-x: clip; }
@media (min-width: 768px) { body { background: #171820; } }
```

Record all measured section heights and atlas crops in `real-pages.module.css`; do not use a whole-page background.

- [x] **Step 7: Run page tests, typecheck, and build**

Run: `pnpm --dir examples/activity-target test && pnpm --dir examples/activity-target typecheck && pnpm --dir examples/activity-target build`

Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add examples/activity-target/src/components/activity
git commit -m "feat(target): 手工实现三张高保真移动活动页"
```

### Task 5: Register trusted page mappings and improve source maps

**Files:**
- Modify: `apps/server/src/profiles.ts`
- Modify: `apps/server/src/production.test.ts`
- Modify: `apps/web/src/lib/production-api.ts`
- Modify: `apps/web/src/lib/production-api.test.ts`
- Modify: `packages/codegen/src/production.ts`
- Modify: `packages/codegen/src/production.test.ts`

- [x] **Step 1: Write failing registration and source-map tests**

```ts
expect(resolveTargetBySampleId("commerce-feed").allowedMappings).toContainEqual({
  codeComponent: "CommerceFeedExperience",
  importPath: "@/components/activity/CommerceFeedExperience",
});
expect(output.sourceMap.locators.find((item) => item.nodeId === "product-grid")?.file)
  .toBe("src/components/activity/CommerceFeedExperience.tsx");
```

Server tests submit the exact registered root mapping and verify an arbitrary component remains `MAPPING_FORBIDDEN`.

- [x] **Step 2: Run focused tests and verify RED**

Run: `pnpm --filter @d2c/codegen test -- --run src/production.test.ts && pnpm --filter @d2c/server test -- --run src/production.test.ts`

Expected: FAIL because registrations and composite source locators are absent.

- [x] **Step 3: Register three samples**

Add explicit registrations with asset root, reference image, fallback semantic score, and one trusted root mapping per page. The registration type gains a server-only `sourceFile` field; response payloads and client mappings never control it.

- [x] **Step 4: Add composite mapping locator inheritance**

When a mapped node replaces a subtree, all descendant Node IDs inherit the registered component source file for attribution. Import aliases are resolved only after the server mapping allowlist enriches the mapping; raw client `importPath` never becomes a filesystem path.

- [x] **Step 5: Add web golden sample payloads**

Load the three committed JSON specs and add mappings with exact trusted component/import pairs and `atlasUrl: "/campaign/reference.jpg"` props.

- [x] **Step 6: Run focused tests**

Run: `pnpm --filter @d2c/codegen test && pnpm --filter @d2c/server test && pnpm --filter @d2c/web test -- --run src/lib/production-api.test.ts`

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add apps/server/src/profiles.ts apps/server/src/production.test.ts apps/web/src/lib/production-api.ts apps/web/src/lib/production-api.test.ts packages/codegen/src/production.ts packages/codegen/src/production.test.ts
git commit -m "feat(production): 注册三张真实活动页与可信组件映射"
```

### Task 6: Normalize reference images and derive asset pHash evidence

**Files:**
- Modify: `packages/evaluator/src/production.ts`
- Modify: `packages/evaluator/src/production.test.ts`
- Modify: `packages/orchestrator/src/production.ts`
- Modify: `packages/orchestrator/src/production.test.ts`

- [x] **Step 1: Add failing image-normalization tests**

Create differently sized equivalent images and assert normalized comparison is available and near-perfect. Add a workflow test where copied assets produce `assetConsistencyAvailable: true` without client asset evidence.

```ts
const result = await compareImageArtifacts(reference1260, render390, { normalizeWidth: 390 });
expect(result.totalPixels).toBeGreaterThan(0);
expect(result.differentPixels / result.totalPixels).toBeLessThan(0.01);
```

- [x] **Step 2: Run evaluator/orchestrator tests and verify RED**

Run: `pnpm --filter @d2c/evaluator test && pnpm --filter @d2c/orchestrator test`

Expected: FAIL because comparison cannot normalize dimensions and pHash evidence is not derived.

- [x] **Step 3: Implement in-memory normalization**

Use Jimp to resize the reference to the current render width while preserving aspect ratio, and compare buffers without writing duplicate fixture files. Reject impossible dimensions and cap decoded pixels.

- [x] **Step 4: Derive pHash after asset copy**

For every generated asset, compare the trusted source file with the copied workspace target using `compareAssetPHash`; pass the result to Evaluator. Client `assetEvidence` remains test-only override and cannot name arbitrary paths.

- [x] **Step 5: Run tests**

Run: `pnpm --filter @d2c/evaluator test && pnpm --filter @d2c/orchestrator test`

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add packages/evaluator/src packages/orchestrator/src
git commit -m "feat(eval): 归一化长图并自动生成素材哈希证据"
```

### Task 7: Implement secret-safe MiniMax two-image semantic review

**Files:**
- Create: `apps/server/src/model-config.ts`
- Create: `apps/server/src/model-config.test.ts`
- Create: `apps/server/src/semantic-review.ts`
- Create: `apps/server/src/semantic-review.test.ts`
- Modify: `apps/server/src/vision.ts`

- [x] **Step 1: Add failing config tests**

```ts
expect(loadModelConfig({
  env: { MINIMAX_API_KEY: "secret", MINIMAX_BASE_URL: "https://example.test", MINIMAX_MODEL: "MiniMax-M3" },
  envFile: "key=legacy\nurl=https://legacy.test\nmodel=legacy-model",
})).toEqual({ apiKey: "secret", baseUrl: "https://example.test", model: "MiniMax-M3" });
expect(JSON.stringify(redactModelError(new Error("secret"), "secret"))).not.toContain("secret");
```

- [x] **Step 2: Add failing semantic-review tests**

Mock the Anthropic-compatible endpoint and assert two image blocks, forced `emit_semantic_review`, valid schema parsing, timeout handling, bad tool response, and no key in errors.

- [x] **Step 3: Run tests and verify RED**

Run: `pnpm --filter @d2c/server test -- --run src/model-config.test.ts src/semantic-review.test.ts`

Expected: FAIL because both modules are absent.

- [x] **Step 4: Implement config loading**

Read standard environment variables first, then parse only `key`, `url`, and `model` from the root `.env`. Never return the key from HTTP handlers or log the config object.

- [x] **Step 5: Implement semantic review**

Call the existing `callAnthropicTool` with reference and render data URLs and this forced tool schema:

```ts
const tool = {
  name: "emit_semantic_review",
  description: "比较参考活动页与实现截图，返回结构化语义一致性评审",
  input_schema: semanticReviewToolSchema,
};
```

Parse with `semanticReviewEvidenceSchema` and set `provider: "minimax"` server-side regardless of model input.

- [x] **Step 6: Run tests and typecheck**

Run: `pnpm --filter @d2c/server test -- --run src/model-config.test.ts src/semantic-review.test.ts && pnpm --filter @d2c/server typecheck`

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add apps/server/src/model-config.ts apps/server/src/model-config.test.ts apps/server/src/semantic-review.ts apps/server/src/semantic-review.test.ts apps/server/src/vision.ts
git commit -m "feat(vlm): 接入MiniMax双图语义评审"
```

### Task 8: Wire semantic evidence through workflow, persistence, and UI

**Files:**
- Modify: `packages/orchestrator/src/production.ts`
- Modify: `packages/orchestrator/src/production.test.ts`
- Modify: `apps/server/src/production.ts`
- Modify: `apps/server/src/production.test.ts`
- Modify: `apps/web/src/lib/production-api.ts`
- Modify: `apps/web/src/components/ProductionWorkbench.tsx`
- Modify: `apps/web/src/components/ProductionWorkbench.test.tsx`

- [x] **Step 1: Add failing workflow and UI tests**

Assert `EVALUATED.data.semanticReview.provider === "minimax"`, persistence survives restart, fallback is labeled, and the UI renders `MiniMax 实时评审` or `黄金基准回退` instead of a generic “有证据”.

- [x] **Step 2: Run tests and verify RED**

Run: `pnpm --filter @d2c/orchestrator test && pnpm --filter @d2c/server test -- --run src/production.test.ts && pnpm --filter @d2c/web test -- --run src/components/ProductionWorkbench.test.tsx`

Expected: FAIL because semantic evidence is score-only.

- [x] **Step 3: Add the semantic adapter**

Extend `ProductionWorkflowAdapters`:

```ts
semanticReview?: (input: {
  referenceScreenshot: string;
  currentScreenshot: string;
  spec: ActivitySpec;
}) => Promise<SemanticReviewEvidence>;
```

Call it once per round. On failure, construct a registered fallback with the server score and a non-secret summary. Pass only the resulting score to Evaluator and attach the full evidence to the evaluation artifact/event.

- [x] **Step 4: Persist and expose evidence**

Add `latestSemanticReview` to the server record snapshot and GET detail. Do not persist model config or request headers.

- [x] **Step 5: Render evidence source in the workbench**

Show provider, four sub-scores, summary, and issues. Preserve existing missing-evidence P1 behavior when neither MiniMax nor fallback exists.

- [x] **Step 6: Run focused tests**

Run: `pnpm --filter @d2c/orchestrator test && pnpm --filter @d2c/server test && pnpm --filter @d2c/web test -- --run src/components/ProductionWorkbench.test.tsx`

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add packages/orchestrator/src apps/server/src apps/web/src
git commit -m "feat(production): 展示并持久化语义评审证据"
```

### Task 9: Extend the Figma import bundle

**Files:**
- Modify: `packages/figma-patcher/src/export.ts`
- Modify: `packages/figma-patcher/src/export.test.ts`
- Modify: `apps/web/src/components/ProductionWorkbench.tsx`
- Modify: `apps/web/src/components/ProductionWorkbench.test.tsx`

- [x] **Step 1: Add failing self-contained bundle tests**

```ts
const bundle = buildFigmaImportBundle(spec, rendered, [{
  id: "reference", mimeType: "image/jpeg", data: "base64-data",
}]);
expect(bundle.version).toBe("2.0");
expect(bundle.viewport).toEqual({ width: 390, height: 867 });
expect(bundle.assets).toHaveLength(1);
expect(bundle.nodes[0]?.pluginData.d2cNodeId).toBe("page");
expect(findNode(bundle, "hero-art")?.imageCrop).toEqual({ x: 0, y: 0.1, width: 1, height: 0.3 });
```

- [x] **Step 2: Run tests and verify RED**

Run: `pnpm --filter @d2c/figma-patcher test -- --run src/export.test.ts`

Expected: FAIL because bundle v1 has no assets or crop metadata.

- [x] **Step 3: Implement bundle v2**

Add strict version, viewport, deduplicated assets, image crop, layout, plugin data, and degradations. Reject asset references that are missing from the asset table.

- [x] **Step 4: Make workbench download assets**

Fetch each trusted render/sample asset as a data URL in the browser, build bundle v2, and disable the download button with an explicit message if an asset cannot be loaded.

- [x] **Step 5: Run tests**

Run: `pnpm --filter @d2c/figma-patcher test && pnpm --filter @d2c/web test -- --run src/components/ProductionWorkbench.test.tsx`

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add packages/figma-patcher/src apps/web/src/components/ProductionWorkbench.tsx apps/web/src/components/ProductionWorkbench.test.tsx
git commit -m "feat(figma): 导出自包含可编辑活动页包"
```

### Task 10: Build the offline Figma import plugin

**Files:**
- Create: `apps/figma-importer-plugin/package.json`
- Create: `apps/figma-importer-plugin/manifest.json`
- Create: `apps/figma-importer-plugin/tsconfig.json`
- Create: `apps/figma-importer-plugin/src/import.ts`
- Create: `apps/figma-importer-plugin/src/import.test.ts`
- Create: `apps/figma-importer-plugin/src/code.ts`
- Create: `apps/figma-importer-plugin/src/ui.html`
- Modify: `pnpm-workspace.yaml`

- [x] **Step 1: Add failing pure importer tests**

Mock the small Figma facade and verify Frame/Text/Rectangle creation, Auto Layout, image fills, crop transform, plugin data, missing-font fallback, and missing-asset degradation.

```ts
const result = await importBundle(bundle, figmaFacade);
expect(result.createdNodes).toBe(bundle.nodes.length);
expect(figmaFacade.setPluginData).toHaveBeenCalledWith(expect.anything(), "d2cNodeId", "hero-title");
expect(result.degradations).toContainEqual(expect.objectContaining({ type: "font-fallback" }));
```

- [x] **Step 2: Run plugin tests and verify RED**

Run: `pnpm --filter @d2c/figma-importer-plugin test`

Expected: FAIL because the package does not exist.

- [x] **Step 3: Implement the pure importer**

Keep Figma globals behind `FigmaFacade`; recursively create nodes from bundle v2, load fonts before assigning characters, create images from decoded base64, set fills and crop transforms, and return a structured import report.

- [x] **Step 4: Implement plugin runtime and UI**

The UI contains one JSON file input, an Import button, validation errors, and a final report. `code.ts` receives the parsed JSON, validates version/shape, invokes the importer, selects the root frame, zooms into view, and posts the report back.

- [x] **Step 5: Build three pre-generated bundles**

Run a checked-in script that loads each ActivitySpec, crop manifest, reference image, and canonical node boxes, then writes `figma-import.json`. Validate all three with the same bundle parser used by the plugin.

- [x] **Step 6: Run plugin tests and build**

Run: `pnpm --filter @d2c/figma-importer-plugin test && pnpm --filter @d2c/figma-importer-plugin build`

Expected: PASS and plugin build artifacts generated from source.

- [x] **Step 7: Commit**

```bash
git add apps/figma-importer-plugin examples/activity-pages/*/figma-import.json pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "feat(figma): 增加离线活动页导入插件"
```

### Task 11: Add real-page workbench presentation and E2E

**Files:**
- Modify: `apps/web/src/components/ProductionWorkbench.tsx`
- Modify: `apps/web/src/components/ProductionWorkbench.test.tsx`
- Modify: `apps/web/src/styles.css`
- Create: `tests/e2e/production-real-pages.spec.ts`
- Modify: `playwright.config.ts`

- [x] **Step 1: Add failing workbench tests**

Assert three thumbnail choices, selected sample metadata, phone-only fidelity label, and semantic evidence source. Existing two sample choices remain available.

- [x] **Step 2: Add failing E2E tests**

For each sample, create a run and assert:

```ts
await expect(page.getByText("COMPLETED")).toBeVisible({ timeout: 420_000 });
await expect(page.getByTestId("production-final-score")).toHaveText(/(8[5-9]|9\d|100)/);
await expect(page.getByText("responsive_error")).toHaveCount(0);
await expect(page.getByTestId("semantic-provider")).toContainText(/MiniMax 实时评审|黄金基准回退/);
```

Inspect the mobile render artifact and assert width `390`, nonzero full-page height, and key node geometry within 3% of reference nodes.

- [x] **Step 3: Run focused tests and verify RED**

Run: `pnpm --filter @d2c/web test -- --run src/components/ProductionWorkbench.test.tsx`

Expected: FAIL because real sample presentation is absent.

- [x] **Step 4: Implement thumbnail selector and phone preview**

Use the sample reference as thumbnail, keep the selector available after completion, label fidelity scope as `390px 手机端`, and preserve the current run state-reset behavior.

- [x] **Step 5: Run web tests**

Run: `pnpm --filter @d2c/web test`

Expected: PASS.

- [x] **Step 6: Run real-page E2E and tune only measured differences**

Run: `pnpm exec playwright test tests/e2e/production-real-pages.spec.ts --workers=1`

Expected: 3 passed. If a page misses geometry or overflow thresholds, adjust only its measured CSS/token/crop values and rerun that one test.

- [x] **Step 7: Commit**

```bash
git add apps/web/src tests/e2e/production-real-pages.spec.ts playwright.config.ts
git commit -m "test(e2e): 覆盖三张真实活动页生产闭环"
```

### Task 12: Documentation, full verification, and push

**Files:**
- Modify: `README.md`
- Modify: `docs/demo-script.md`
- Modify: `docs/superpowers/specs/2026-08-28-activity-page-production-system-design.md`
- Modify: `docs/superpowers/plans/2026-08-29-real-mobile-activity-golden-samples.md`

- [x] **Step 1: Update documentation truthfully**

Document five total golden samples, three real mobile pages, MiniMax live/fallback states, self-contained Figma bundle, offline plugin import steps, phone-only fidelity scope, and remaining 12-page goal.

- [x] **Step 2: Mark completed plan checkboxes**

Only mark a checkbox complete after its command has passed or its file has been reviewed. Leave any externally blocked real Figma desktop validation explicitly unchecked.

- [x] **Step 3: Run fresh full verification**

Run, in order:

```text
pnpm test
pnpm typecheck
pnpm build
pnpm e2e
git diff --check
```

Expected: all tests and six-plus-three production/browser E2E cases pass; build may retain the documented non-blocking web chunk-size warning.

- [x] **Step 4: Inspect final evidence**

For all three new runs verify persisted fields:

```text
status=completed
perceptualDiffAvailable=true
assetConsistencyAvailable=true
semanticReviewAvailable=true
responsiveBehavior=100
latestSemanticReview.provider=minimax|registered-fallback
```

Confirm no server, Vite, or preview listener remains on 5173, 8787, or 4173.

- [x] **Step 5: Commit documentation and final fixes**

```bash
git add README.md docs packages apps examples tests pnpm-lock.yaml
git commit -m "feat(production): 完成真实移动活动页高保真演示链路"
```

Before committing, inspect `git status --short` and ensure the four pre-existing untracked personal files are not staged.

- [x] **Step 6: Push**

Run: `git push origin master`

Expected: local `HEAD` and `origin/master` resolve to the same commit.

