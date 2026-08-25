import { describe, expect, it } from "vitest";
import { compareEvaluations, createEvaluation } from "./index";

describe("evaluation scoring", () => {
  it("calculates weighted scores and resolved violations", () => {
    const first = createEvaluation(
      1,
      {
        geometry: 68,
        componentReuse: 70,
        tokenCompliance: 65,
        visualFidelity: 80,
        semanticStructure: 80,
        codeQuality: 80,
      },
      [
        {
          id: "hardcoded-gap",
          severity: "P1",
          category: "token",
          nodeId: "grid",
          message: "Grid gap is hardcoded",
          suggestion: "Use spacing/lg",
        },
      ],
    );
    const second = createEvaluation(
      2,
      {
        geometry: 94,
        componentReuse: 95,
        tokenCompliance: 95,
        visualFidelity: 92,
        semanticStructure: 93,
        codeQuality: 94,
      },
      [],
      ["hardcoded-gap"],
    );

    expect(first.overall).toBe(72);
    expect(second.overall).toBe(94);
    expect(compareEvaluations(first, second)).toEqual({
      delta: 22,
      resolvedViolationIds: ["hardcoded-gap"],
    });
  });

  it("rejects out-of-range metric values", () => {
    expect(() =>
      createEvaluation(1, {
        geometry: 101,
        componentReuse: 70,
        tokenCompliance: 65,
        visualFidelity: 80,
        semanticStructure: 80,
        codeQuality: 80,
      }),
    ).toThrow();
  });

  it("rounds exact half values consistently upward", () => {
    // 57.75：旧实现的浮点误差会舍到 57.7；整数域计算必须进位到 57.8。
    const first = createEvaluation(1, {
      geometry: 97,
      componentReuse: 34,
      tokenCompliance: 38,
      visualFidelity: 52,
      semanticStructure: 29,
      codeQuality: 84,
    });
    // 72.25：必须进位到 72.3。
    const second = createEvaluation(2, {
      geometry: 69,
      componentReuse: 70,
      tokenCompliance: 65,
      visualFidelity: 80,
      semanticStructure: 80,
      codeQuality: 80,
    });

    expect(first.overall).toBe(57.8);
    expect(second.overall).toBe(72.3);
  });
});

describe("compareEvaluations", () => {
  const violation = (id: string) => ({
    id,
    severity: "P1" as const,
    category: "token",
    message: `violation ${id}`,
    suggestion: "fix it",
  });

  it("keeps explicitly empty resolved lists empty", () => {
    const previous = createEvaluation(1, {
      geometry: 68, componentReuse: 70, tokenCompliance: 65,
      visualFidelity: 80, semanticStructure: 80, codeQuality: 80,
    }, [violation("v1")]);
    const current = createEvaluation(2, {
      geometry: 94, componentReuse: 95, tokenCompliance: 95,
      visualFidelity: 92, semanticStructure: 93, codeQuality: 94,
    }, [violation("v1")], []);

    expect(compareEvaluations(previous, current).resolvedViolationIds).toEqual([]);
  });

  it("rejects declared resolutions that did not actually happen", () => {
    const previous = createEvaluation(1, {
      geometry: 68, componentReuse: 70, tokenCompliance: 65,
      visualFidelity: 80, semanticStructure: 80, codeQuality: 80,
    }, [violation("v1")]);
    // v1 仍在本轮违规里（未真正修复），ghost 从未存在过。
    const current = createEvaluation(2, {
      geometry: 94, componentReuse: 95, tokenCompliance: 95,
      visualFidelity: 92, semanticStructure: 93, codeQuality: 94,
    }, [violation("v1")], ["v1", "ghost", "v1"]);

    expect(compareEvaluations(previous, current).resolvedViolationIds).toEqual([]);
  });

  it("deduplicates and validates derived resolutions", () => {
    const previous = createEvaluation(1, {
      geometry: 68, componentReuse: 70, tokenCompliance: 65,
      visualFidelity: 80, semanticStructure: 80, codeQuality: 80,
    }, [violation("v1"), violation("v2")]);
    const current = createEvaluation(2, {
      geometry: 94, componentReuse: 95, tokenCompliance: 95,
      visualFidelity: 92, semanticStructure: 93, codeQuality: 94,
    }, [violation("v2")], ["v1", "v1"]);

    expect(compareEvaluations(previous, current).resolvedViolationIds).toEqual(["v1"]);
  });
});
