import { describe, expect, it } from "vitest";
import {
  designBundleSchema,
  evaluationReportSchema,
  traceEventSchema,
  uiSpecSchema,
} from "./index";

const validNode = {
  id: "1",
  name: "Root",
  type: "FRAME",
  width: 1440,
  height: 900,
  layoutMode: "VERTICAL",
  layoutSizingHorizontal: "FIXED",
  layoutSizingVertical: "FIXED",
  children: [],
};

describe("designBundleSchema", () => {
  it("rejects nodes without sizing information", () => {
    const result = designBundleSchema.safeParse({
      manifest: {
        protocolVersion: "1.0",
        name: "Product Grid",
        viewport: { width: 1440, height: 900 },
      },
      nodes: [{ id: "1", name: "Root", type: "FRAME", children: [] }],
      variables: [],
      components: [],
    });

    expect(result.success).toBe(false);
  });

  it("accepts a complete offline bundle", () => {
    const result = designBundleSchema.safeParse({
      manifest: {
        protocolVersion: "1.0",
        name: "Product Grid",
        viewport: { width: 1440, height: 900 },
      },
      nodes: [validNode],
      variables: [],
      components: [],
    });

    expect(result.success).toBe(true);
  });

  it("rejects negative gap values", () => {
    const result = designBundleSchema.safeParse({
      manifest: {
        protocolVersion: "1.0",
        name: "Product Grid",
        viewport: { width: 1440, height: 900 },
      },
      nodes: [{ ...validNode, gap: -50 }],
      variables: [],
      components: [],
    });

    expect(result.success).toBe(false);
  });
});

describe("shared artifacts", () => {
  it("validates UISpec, trace and evaluation records", () => {
    const uiSpec = uiSpecSchema.parse({
      version: 1,
      name: "Product Grid",
      viewport: { width: 1440, height: 900 },
      root: {
        id: "1",
        name: "Root",
        type: "FRAME",
        semanticRole: "page",
        layout: { direction: "column", width: "fixed", height: "fixed" },
        styles: {},
        children: [],
      },
    });
    const trace = traceEventSchema.parse({
      id: "evt-1",
      runId: "run-1",
      timestamp: "2026-08-24T00:00:00.000Z",
      state: "VALIDATED",
      title: "Bundle validated",
    });
    const evaluation = evaluationReportSchema.parse({
      iteration: 1,
      overall: 72,
      metrics: {
        geometry: 70,
        componentReuse: 75,
        tokenCompliance: 65,
        visualFidelity: 78,
        semanticStructure: 80,
        codeQuality: 70,
      },
      violations: [],
    });

    expect(uiSpec.root.semanticRole).toBe("page");
    expect(trace.state).toBe("VALIDATED");
    expect(evaluation.overall).toBe(72);
  });
});
