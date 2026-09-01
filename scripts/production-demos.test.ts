import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { expect, it } from "vitest";

const samples = ["commerce-feed", "summer-game-festival", "pet-red-packet"];
it.each(samples)("%s 的演示包自包含成功实跑、逐步证据、源码和两张 PNG", (sampleId) => {
  const bundle = JSON.parse(readFileSync(resolve("apps/web/public/production-demos", `${sampleId}.json`), "utf8"));
  expect(bundle.sampleId).toBe(sampleId);
  expect(bundle.run.sampleId).toBe(sampleId);
  expect(bundle.run.state).toBe("COMPLETED");
  expect(bundle.run.status).toBe("completed");
  expect(bundle.recordedAt).toBe(bundle.run.createdAt);
  const states = bundle.run.events.map((event: { state: string }) => event.state);
  expect(states).toEqual(expect.arrayContaining(["INPUT_VALIDATED", "PROJECT_INSPECTED", "SPEC_VALIDATED", "MAPPINGS_RESOLVED", "CODE_PLANNED", "GENERATED", "TYPECHECKED", "BUILT", "RENDERED", "EVALUATED", "ATTRIBUTED", "COMPLETED"]));
  for (const event of bundle.run.events) {
    expect(event.runId).toBe(bundle.run.id);
    expect(bundle.artifacts[event.data.inputArtifactId]).toBeDefined();
    if (event.data.artifactId) expect(bundle.artifacts[event.data.artifactId]).toBeDefined();
    if (["BUILT", "TYPECHECKED"].includes(event.state)) expect(bundle.artifacts[event.data.artifactId].content.exitCode).toBe(0);
  }
  const output = bundle.artifacts[bundle.run.events.at(-1).data.artifactId].content;
  expect(output.contentsSource).toBe("run-end-snapshot");
  expect(Object.keys(output.contents)).toHaveLength(3);
  expect(output.unavailableFiles).toEqual([]);
  expect(Object.values(output.contents).join("\n")).toContain("export");
  expect(bundle.preview.runId).toBe(bundle.run.id);
  expect(bundle.preview.url).toBe(`/production-previews/index.html?run=${bundle.run.id}`);
  const manifest = JSON.parse(readFileSync("apps/web/public/production-previews/build-manifest.json", "utf8"));
  expect(manifest.runs).toContainEqual({ sampleId, runId: bundle.run.id });
  for (const [path, content] of Object.entries(output.contents)) {
    expect(manifest.sources[`${bundle.run.id}/${path}`]).toBe(createHash("sha256").update(content as string).digest("hex"));
  }
  const html = readFileSync("apps/web/public/production-previews/index.html", "utf8");
  expect(html).toMatch(/<script[^>]+type="module"/);
  for (const asset of html.matchAll(/(?:src|href)="(\/production-previews\/assets\/[^"]+)"/g)) {
    expect(readFileSync(resolve("apps/web/public", asset[1]!.slice(1))).length).toBeGreaterThan(100);
  }
  const render = bundle.artifacts[bundle.run.events.findLast((event: { state: string }) => event.state === "RENDERED").data.artifactId].content;
  const evaluation = bundle.run.events.findLast((event: { state: string }) => event.state === "EVALUATED");
  expect(bundle.artifacts[evaluation.data.inputArtifactId].content.build.runtimeErrors).toEqual([]);
  expect(render.viewports).toHaveLength(2);
  for (const viewport of render.viewports) {
    expect(viewport.horizontalOverflow).toBe(false);
    const png = Buffer.from(bundle.screenshots[viewport.name].split(",")[1], "base64");
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.length).toBeGreaterThan(100_000);
  }
  expect(bundle.run.violations.filter((v: { severity: string }) => ["P0", "P1"].includes(v.severity))).toEqual([]);
  // 未配置在线模型时保留真实 fallback 标识，不能把注册基准称为现场模型评审。
  expect(bundle.run.latestSemanticReview.provider).toBe("registered-fallback");
});
