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
});
