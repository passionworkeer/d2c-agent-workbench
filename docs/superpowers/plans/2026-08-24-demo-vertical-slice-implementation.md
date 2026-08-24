# D2C Agent Workbench Demo Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a locally runnable demo that uploads a Figma Bundle and visibly completes UISpec compilation, SDS component mapping, replayed Agent execution, evaluation, repair, preview, code diff, and trace.

**Architecture:** A pnpm TypeScript workspace shares Zod contracts across a Fastify server and React/Vite client. The server parses a safe ZIP bundle, compiles UISpec, maps a fixed SDS registry, and streams a deterministic replay workflow; the client presents the three-column interview demo. This vertical slice deliberately uses ReplayAdapter and a fixed SDS target so the whole user journey is reliable before real Codex and repository indexing replace those adapters.

**Tech Stack:** TypeScript, pnpm workspaces, React, Vite, Fastify, Zod, fflate, Vitest, Testing Library, Playwright

---

## Scope decomposition

The approved design contains four independently testable subsystems. This plan implements the first one: the reliable interview demo vertical slice. After it passes browser acceptance, implementation continues through three focused plans: real repository indexing plus Codex execution, Figma exporter plus patch application, and production evaluation plus reusable Skill/CLI adapters. Keeping those changes outside this plan prevents unstable external integrations from delaying the first working demo.

## File map

- `package.json`: root scripts and shared development dependencies.
- `pnpm-workspace.yaml`: workspace package discovery.
- `tsconfig.base.json`: shared strict TypeScript settings.
- `packages/contracts/src/index.ts`: Bundle, UISpec, Trace, mapping and evaluation schemas.
- `packages/figma-importer/src/index.ts`: safe ZIP parsing and Bundle validation.
- `packages/ui-compiler/src/index.ts`: normalized design nodes to UISpec.
- `packages/component-matcher/src/index.ts`: deterministic SDS candidate mapping with evidence.
- `packages/orchestrator/src/index.ts`: replay workflow and state transitions.
- `packages/evaluator/src/index.ts`: weighted score and repair comparison.
- `apps/server/src/app.ts`: Fastify routes and SSE delivery.
- `apps/web/src/App.tsx`: three-column demo workbench.
- `apps/web/src/lib/api.ts`: upload and SSE client.
- `examples/figma-bundles/product-grid/*`: deterministic demo input.
- `examples/sds-target/*`: generated-code and preview fixture.
- `e2e/demo.spec.ts`: browser-level demo acceptance.

### Task 1: Bootstrap the TypeScript workspace

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`

- [ ] **Step 1: Add the root package manifest**

```json
{
  "name": "d2c-agent-workbench",
  "private": true,
  "packageManager": "pnpm@10.15.0",
  "scripts": {
    "build": "pnpm -r build",
    "dev": "pnpm --parallel --filter @d2c/server --filter @d2c/web dev",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "e2e": "playwright test"
  },
  "devDependencies": {
    "@playwright/test": "^1.55.0",
    "typescript": "^5.9.2",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 2: Add workspace and TypeScript configuration**

```yaml
packages:
  - apps/*
  - packages/*
```

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "esModuleInterop": true
  }
}
```

- [ ] **Step 3: Add generated-file ignores**

```gitignore
node_modules/
dist/
coverage/
playwright-report/
test-results/
runs/
*.local
```

- [ ] **Step 4: Install dependencies and verify the workspace**

Run: `pnpm install`

Expected: exit code 0 and a generated `pnpm-lock.yaml`.

- [ ] **Step 5: Commit the bootstrap**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .gitignore pnpm-lock.yaml
git commit -m "chore: 初始化D2C工作区"
```

### Task 2: Define shared contracts

**Files:**
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/index.test.ts`

- [ ] **Step 1: Write a failing schema test**

```ts
import { describe, expect, it } from "vitest";
import { designBundleSchema } from "./index";

describe("designBundleSchema", () => {
  it("rejects a node without sizing information", () => {
    const result = designBundleSchema.safeParse({
      manifest: { protocolVersion: "1.0", name: "Product Grid", viewport: { width: 1440, height: 900 } },
      nodes: [{ id: "1", name: "Root", type: "FRAME", children: [] }],
      variables: [],
      components: []
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm --filter @d2c/contracts test`

Expected: FAIL because the package and schema do not exist.

- [ ] **Step 3: Implement the contracts package**

Define Zod schemas for `DesignBundle`, recursive `DesignNode`, `UISpec`, `ComponentMapping`, `TraceEvent`, `EvaluationReport`, and workflow states. Require every design node to contain `width`, `height`, `layoutMode`, `layoutSizingHorizontal`, `layoutSizingVertical`, `children`, and optional token bindings.

```ts
export const workflowStateSchema = z.enum([
  "UPLOADED", "VALIDATED", "NORMALIZED", "ASSETS_INDEXED",
  "COMPONENTS_MAPPED", "CODE_PLANNED", "GENERATED", "BUILT",
  "EVALUATED", "REPAIRING", "COMPLETED", "NEEDS_REVIEW", "FAILED"
]);
```

Export inferred TypeScript types from every schema.

- [ ] **Step 4: Run contract tests and typecheck**

Run: `pnpm --filter @d2c/contracts test && pnpm --filter @d2c/contracts typecheck`

Expected: PASS.

- [ ] **Step 5: Commit contracts**

```bash
git add packages/contracts
git commit -m "feat: 定义D2C共享协议"
```

### Task 3: Parse and validate Figma Bundle ZIP files

**Files:**
- Create: `packages/figma-importer/package.json`
- Create: `packages/figma-importer/src/index.ts`
- Test: `packages/figma-importer/src/index.test.ts`
- Create: `examples/figma-bundles/product-grid/manifest.json`
- Create: `examples/figma-bundles/product-grid/design.json`
- Create: `examples/figma-bundles/product-grid/variables.json`
- Create: `examples/figma-bundles/product-grid/components.json`
- Create: `examples/figma-bundles/product-grid/preview/root.svg`

- [ ] **Step 1: Write failing importer tests**

Create one valid in-memory ZIP and one ZIP containing `../escape.txt`. Assert that `parseFigmaBundle()` returns a validated bundle for the first and throws `INPUT_INVALID` for the second.

- [ ] **Step 2: Run the importer tests**

Run: `pnpm --filter @d2c/figma-importer test`

Expected: FAIL because `parseFigmaBundle` does not exist.

- [ ] **Step 3: Implement minimal safe ZIP parsing**

Use `fflate.unzipSync`, reject absolute paths and `..` segments, cap entries at 200 and uncompressed bytes at 20 MB, parse the four required JSON files, and validate the combined object with `designBundleSchema`.

```ts
export class BundleError extends Error {
  readonly code = "INPUT_INVALID";
}
```

- [ ] **Step 4: Add the product-grid fixture**

The fixture must contain a 1440×900 vertical root frame, a horizontal header instance, a four-column product grid, four product-card instances, bound color/spacing/radius variables, and an SVG preview that visually matches the metadata.

- [ ] **Step 5: Run importer tests and typecheck**

Run: `pnpm --filter @d2c/figma-importer test && pnpm --filter @d2c/figma-importer typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the importer**

```bash
git add packages/figma-importer examples/figma-bundles/product-grid
git commit -m "feat: 支持离线Figma资产包"
```

### Task 4: Compile UISpec and map SDS components

**Files:**
- Create: `packages/ui-compiler/package.json`
- Create: `packages/ui-compiler/src/index.ts`
- Test: `packages/ui-compiler/src/index.test.ts`
- Create: `packages/component-matcher/package.json`
- Create: `packages/component-matcher/src/index.ts`
- Test: `packages/component-matcher/src/index.test.ts`

- [ ] **Step 1: Write failing compiler and matcher tests**

Assert that the product grid compiles to `display: grid` semantics, the header compiles to a row, bound values preserve token names, `Button/Primary` maps to `Button` with `variant: primary`, and `Product Card/Default` maps to `ProductCard` with confidence at least 0.8.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @d2c/ui-compiler test && pnpm --filter @d2c/component-matcher test`

Expected: FAIL because the compiler and matcher do not exist.

- [ ] **Step 3: Implement recursive UISpec compilation**

Map Figma horizontal/vertical Auto Layout to row/column, preserve sizing modes and token references, derive semantic roles from normalized node names, and never mutate the input bundle.

- [ ] **Step 4: Implement the fixed SDS registry and evidence**

Provide `Header`, `ProductCard`, `Button`, `Badge`, and `Text` entries with import paths, props, accepted Figma names, token prefixes, and evidence strings. Rank exact component names first, then normalized names and compatible props.

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm --filter @d2c/ui-compiler test && pnpm --filter @d2c/component-matcher test && pnpm -r typecheck`

Expected: PASS.

- [ ] **Step 6: Commit compiler and matcher**

```bash
git add packages/ui-compiler packages/component-matcher
git commit -m "feat: 编译UISpec并匹配SDS组件"
```

### Task 5: Build replay orchestration and evaluation

**Files:**
- Create: `packages/evaluator/package.json`
- Create: `packages/evaluator/src/index.ts`
- Test: `packages/evaluator/src/index.test.ts`
- Create: `packages/orchestrator/package.json`
- Create: `packages/orchestrator/src/index.ts`
- Test: `packages/orchestrator/src/index.test.ts`

- [ ] **Step 1: Write failing evaluation tests**

Use reports where geometry/component/token/visual/semantic/code scores produce overall scores of 72 and 94. Assert that `compareEvaluations()` reports `+22` and lists resolved violations.

- [ ] **Step 2: Write a failing workflow test**

Collect `runReplayWorkflow()` events and assert the exact terminal sequence includes `EVALUATED`, `REPAIRING`, a second `EVALUATED`, and `COMPLETED`, with scores 72 then 94.

- [ ] **Step 3: Run tests and verify failure**

Run: `pnpm --filter @d2c/evaluator test && pnpm --filter @d2c/orchestrator test`

Expected: FAIL because both implementations are missing.

- [ ] **Step 4: Implement weighted evaluation**

Use weights 25/20/20/15/10/10 and reject non-finite or out-of-range metric values. Include P0/P1/P2 violations, mapped node IDs, suggested fixes, resolved violation IDs, and score delta.

- [ ] **Step 5: Implement replay events**

Yield typed events for every workflow state, component evidence, generated files, first evaluation, repair patches, second evaluation, and completion. Use short configurable delays; tests pass `{ delayMs: 0 }`.

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm --filter @d2c/evaluator test && pnpm --filter @d2c/orchestrator test && pnpm -r typecheck`

Expected: PASS.

- [ ] **Step 7: Commit workflow and evaluation**

```bash
git add packages/evaluator packages/orchestrator
git commit -m "feat: 实现评测修复与回放工作流"
```

### Task 6: Expose upload, run state and SSE APIs

**Files:**
- Create: `apps/server/package.json`
- Create: `apps/server/src/app.ts`
- Create: `apps/server/src/index.ts`
- Test: `apps/server/src/app.test.ts`

- [ ] **Step 1: Write failing API tests**

Use Fastify injection to assert `GET /api/health` returns `{ status: "ok" }`, `POST /api/runs/demo` returns a run ID, `GET /api/runs/:id` returns current artifacts, and unknown runs return 404 with `RUN_NOT_FOUND`.

- [ ] **Step 2: Run the server tests**

Run: `pnpm --filter @d2c/server test`

Expected: FAIL because the Fastify app does not exist.

- [ ] **Step 3: Implement the app and in-memory run registry**

Create a Fastify factory with health, demo-run, upload-run, run detail and SSE event routes. Start replay work asynchronously, append events to the run record, and close SSE after terminal state.

- [ ] **Step 4: Verify API tests and typecheck**

Run: `pnpm --filter @d2c/server test && pnpm --filter @d2c/server typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the server**

```bash
git add apps/server
git commit -m "feat: 提供D2C运行与事件接口"
```

### Task 7: Build the three-column Workbench UI

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/src/styles.css`
- Create: `apps/web/src/lib/api.ts`
- Test: `apps/web/src/App.test.tsx`

- [ ] **Step 1: Write a failing UI test**

Mock the API client, render `App`, start the demo, deliver replay events, and assert the page displays `Design Source`, `Agent Trace`, `Delivery`, `72`, `94`, `+22`, `ProductCard`, and `COMPLETED`.

- [ ] **Step 2: Run the UI test**

Run: `pnpm --filter @d2c/web test`

Expected: FAIL because the web app does not exist.

- [ ] **Step 3: Implement API and SSE clients**

Expose `startDemoRun()`, `uploadBundle(file)`, `getRun(id)`, and `subscribeToRun(id, onEvent)`. Return an unsubscribe function that closes the `EventSource`.

- [ ] **Step 4: Implement the interview-oriented UI**

Build a dark three-column workbench with a top progress rail. The left column shows the SVG design preview, node tree summary and token pills; the middle shows workflow events, component evidence and repair activity; the right shows a live React-style preview, generated file diff and evaluation scorecard. Include buttons for `Run demo`, `Upload Figma Bundle`, `Replay`, and `Download report`.

- [ ] **Step 5: Run tests, typecheck and production build**

Run: `pnpm --filter @d2c/web test && pnpm --filter @d2c/web typecheck && pnpm --filter @d2c/web build`

Expected: PASS and `apps/web/dist` exists.

- [ ] **Step 6: Commit the UI**

```bash
git add apps/web
git commit -m "feat: 完成D2C三栏演示工作台"
```

### Task 8: Add browser acceptance and demo documentation

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/demo.spec.ts`
- Create: `README.md`
- Create: `docs/demo-script.md`

- [ ] **Step 1: Write the failing browser acceptance test**

Start server and web through Playwright web servers. Click `Run demo`, wait for `COMPLETED`, assert first and final scores, verify the preview, component evidence, repair delta and downloadable report are visible.

- [ ] **Step 2: Run the E2E test and verify failure**

Run: `pnpm e2e`

Expected: FAIL until web/server integration and selectors are complete.

- [ ] **Step 3: Fix only integration gaps exposed by E2E**

Use Vite proxy `/api` to `http://127.0.0.1:8787`, add stable `data-testid` selectors, and ensure terminal SSE events close cleanly.

- [ ] **Step 4: Add concise setup and interview script**

Document prerequisites, `pnpm install`, `pnpm dev`, `pnpm test`, `pnpm e2e`, offline Replay behavior, architecture summary, attribution, and a ten-minute Chinese interview walkthrough.

- [ ] **Step 5: Run the full verification suite**

Run: `pnpm typecheck && pnpm test && pnpm build && pnpm e2e`

Expected: all commands exit 0.

- [ ] **Step 6: Commit the vertical slice**

```bash
git add playwright.config.ts e2e README.md docs/demo-script.md apps/web packages apps/server examples
git commit -m "test: 验证D2C演示完整闭环"
```

### Task 9: Push and verify the private repository

**Files:**
- Modify: none

- [ ] **Step 1: Verify the worktree**

Run: `git status --short`

Expected: no output.

- [ ] **Step 2: Push the branch**

Run: `git push -u origin master`

Expected: the private GitHub repository receives all commits.

- [ ] **Step 3: Verify repository privacy and latest commit**

Run: `gh repo view passionworkeer/d2c-agent-workbench --json isPrivate,defaultBranchRef,url`

Expected: `isPrivate` is `true` and the default branch points to the pushed commit.
