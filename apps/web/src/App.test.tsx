import type { TraceEvent } from "@d2c/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "./App";

const events: TraceEvent[] = [
  {
    id: "1",
    runId: "run-demo",
    timestamp: "2026-08-24T12:00:00.000Z",
    state: "COMPONENTS_MAPPED",
    title: "Components mapped",
    data: {
      mappings: [
        {
          nodeId: "card",
          figmaComponent: "Product Card / Default",
          codeComponent: "ProductCard",
          importPath: "@/components/ProductCard",
          props: { tone: "cobalt" },
          confidence: 0.96,
          status: "accepted",
          evidence: ["Exact Figma component name matched"],
        },
      ],
    },
  },
  {
    id: "2",
    runId: "run-demo",
    timestamp: "2026-08-24T12:00:01.000Z",
    state: "EVALUATED",
    title: "Eval iteration 1",
    data: { evaluation: { iteration: 1, overall: 72, metrics: {}, violations: [] } },
  },
  {
    id: "3",
    runId: "run-demo",
    timestamp: "2026-08-24T12:00:02.000Z",
    state: "EVALUATED",
    title: "Eval iteration 2",
    data: { evaluation: { iteration: 2, overall: 94, metrics: {}, violations: [] } },
  },
  {
    id: "4",
    runId: "run-demo",
    timestamp: "2026-08-24T12:00:03.000Z",
    state: "COMPLETED",
    title: "Delivery ready",
    data: { scoreDelta: 22, generatedCode: "export function ProductGridPage() {}" },
  },
];

vi.mock("./lib/api", () => ({
  startDemoRun: vi.fn(async () => ({ runId: "run-demo" })),
  uploadBundle: vi.fn(async () => ({ runId: "run-demo" })),
  getRun: vi.fn(async () => ({
    id: "run-demo",
    state: "UPLOADED",
    status: "running",
    previewUrl: "data:image/svg+xml;base64,PHN2Zy8+",
    events: [],
    evaluations: [],
    mappings: [],
    uiSpec: {
      version: 1,
      name: "Kinetic Product Grid",
      viewport: { width: 1440, height: 900 },
      root: { children: [{ id: "grid" }] },
    },
  })),
  subscribeToRun: vi.fn((_id: string, onEvent: (event: TraceEvent) => void) => {
    events.forEach(onEvent);
    return () => undefined;
  }),
}));

describe("D2C workbench", () => {
  it("shows the full replay evidence and score improvement", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /run demo/i }));

    expect(await screen.findByText("ProductCard")).toBeInTheDocument();
    expect(screen.getByTestId("initial-score")).toHaveTextContent("72");
    expect(screen.getByTestId("final-score")).toHaveTextContent("94");
    expect(screen.getByTestId("score-delta")).toHaveTextContent("+22");
    expect(screen.getAllByText("COMPLETED").length).toBeGreaterThan(0);
    expect(screen.getByText("Design Source")).toBeInTheDocument();
    expect(screen.getByText("Agent Trace")).toBeInTheDocument();
    expect(screen.getByText("Delivery")).toBeInTheDocument();
  });
});
