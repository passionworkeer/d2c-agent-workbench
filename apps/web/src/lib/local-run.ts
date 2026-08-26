import type { ComponentMapping, TraceEvent, UISpec } from "@d2c/contracts";
import { zipSync, type Zippable } from "fflate";
import { parseFigmaBundle } from "@d2c/figma-importer";
import { compileUISpec } from "@d2c/ui-compiler";
import { mapSdsComponents } from "@d2c/component-matcher";
import { runReplayWorkflow } from "@d2c/orchestrator";

// 浏览器内真实执行：直接 import fixture JSON / SVG，构建 zip → figma-importer → ui-compiler →
// matcher → orchestrator.runReplayWorkflow。这条路径与上传到 server → SSE 的路径调用同一条
// 确定性管线，差别仅在 spec/mappings 是浏览器内构造还是 server 端 SSE 推送；两端的事件序列
// 由 scripts/consistency.test.ts 的「web 本地 ≡ 服务端」断言守护一致。

// Vite 把 fixture 文件直接打包进 bundle；走 ?raw 拿到字符串内容（JSON 解析在浏览器与 Node 都可用）。
import productGridManifest from "../../../../examples/figma-bundles/product-grid/manifest.json?raw";
import productGridDesign from "../../../../examples/figma-bundles/product-grid/design.json?raw";
import productGridVariables from "../../../../examples/figma-bundles/product-grid/variables.json?raw";
import productGridComponents from "../../../../examples/figma-bundles/product-grid/components.json?raw";
import productGridPreview from "../../../../examples/figma-bundles/product-grid/preview/root.svg?raw";

export type LocalFixtureId = "product-grid";

interface LocalFixture {
  id: LocalFixtureId;
  runId: string;
  files: Record<string, string>;
}

const fixtures: Record<LocalFixtureId, LocalFixture> = {
  "product-grid": {
    id: "product-grid",
    runId: "local-demo",
    files: {
      "manifest.json": productGridManifest,
      "design.json": productGridDesign,
      "variables.json": productGridVariables,
      "components.json": productGridComponents,
      "preview/root.svg": productGridPreview,
    },
  },
};

function asEntries(record: Record<string, string>): Zippable {
  const out: Record<string, [Uint8Array, { level: 0 }]> = {};
  for (const [name, text] of Object.entries(record)) {
    out[name] = [new TextEncoder().encode(text), { level: 0 }];
  }
  return out;
}

export function buildLocalBundle(fixtureId: LocalFixtureId): Uint8Array {
  return zipSync(asEntries(fixtures[fixtureId].files));
}

export interface LocalSpecBundle {
  spec: UISpec;
  mappings: ComponentMapping[];
}

export function loadLocalSpecAndMappings(fixtureId: LocalFixtureId): LocalSpecBundle {
  const bundle = parseFigmaBundle(buildLocalBundle(fixtureId));
  const spec = compileUISpec(bundle);
  const mappings = mapSdsComponents(spec);
  return { spec, mappings };
}

// 同步排空 runReplayWorkflow —— delayMs=0 时所有 wait() 都是 Promise.resolve()，
// for-await 立刻消费完整个生成器并返回 12 步事件序列。
export async function createLocalRunEvents(fixtureId: LocalFixtureId): Promise<TraceEvent[]> {
  const fixture = fixtures[fixtureId];
  const { spec, mappings } = loadLocalSpecAndMappings(fixtureId);
  const events: TraceEvent[] = [];
  for await (const event of runReplayWorkflow({ runId: fixture.runId, spec, mappings, delayMs: 0 })) {
    events.push(event);
  }
  return events;
}

// 节奏播放：与旧 playMockWorkflow 同一份 setTimeout 语义，但事件由真实管线产出。
// cancel 时除了 clearTimeout，还要手动 resolve 当前正在等待的 promise，
// 否则 for-of 循环会永远卡在已经清掉的 timer 上。
export function playEvents(
  events: TraceEvent[],
  onEvent: (event: TraceEvent) => void,
  options: { delayMs?: number } = {},
): { cancel: () => void; done: Promise<void> } {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolveWait: (() => void) | undefined;
  const delayMs = options.delayMs ?? 220;
  const done = (async () => {
    for (const item of events) {
      if (cancelled) return;
      await new Promise<void>((resolve) => {
        resolveWait = resolve;
        timer = setTimeout(() => resolve(), delayMs);
      });
      resolveWait = undefined;
      if (cancelled) return;
      onEvent(item);
    }
  })();
  return {
    cancel: () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      resolveWait?.();
    },
    done,
  };
}

export function extractRunDetail(events: TraceEvent[]): {
  id: string;
  status: "completed" | "running";
  state: TraceEvent["state"];
  uiSpec: UISpec | null;
  mappings: ComponentMapping[];
} {
  let uiSpec: UISpec | null = null;
  let mappings: ComponentMapping[] = [];
  for (const event of events) {
    if (event.data?.uiSpec && !uiSpec) uiSpec = event.data.uiSpec as UISpec;
    const m = event.data?.mappings as ComponentMapping[] | undefined;
    if (m) mappings = m;
  }
  const last = events.at(-1);
  return {
    id: events[0]?.runId ?? "local-demo",
    status: last?.state === "COMPLETED" ? "completed" : "running",
    state: last?.state ?? "UPLOADED",
    uiSpec,
    mappings,
  };
}
