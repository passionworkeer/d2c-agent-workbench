import type { TraceEvent } from "@d2c/contracts";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, expect, it, vi } from "vitest";
import { ProductionOutputs } from "./ProductionOutputs";

const getArtifact = vi.hoisted(() => vi.fn());
vi.mock("../lib/production-api", () => ({ getProductionArtifact: getArtifact }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const terminal: TraceEvent = { id: "failed", runId: "prod-1", state: "FAILED", title: "修复失败", detail: "no repairable violations", timestamp: "2026-08-31T00:00:00Z", data: { artifactId: "final-source" } };
const generated: TraceEvent = { ...terminal, id: "generated", state: "GENERATED", data: { artifactId: "initial-source" } };
const props = { runId: "prod-1", running: false, events: [generated, terminal], terminalEvent: terminal, generatedEvent: generated, viewports: [{ name: "desktop", width: 390, height: 867 }], report: { events: [terminal] }, onDownloadReport: vi.fn() };

it("失败后仍能下载终态源码和截图，代码包包含完整错误及版本说明", async () => {
  getArtifact.mockResolvedValue({ content: { contentsSource: "run-end-snapshot", contents: { "src/Page.tsx": "export const Page = () => <main>最终代码</main>;" }, unavailableFiles: [] } });
  let downloaded!: Blob;
  vi.stubGlobal("URL", { createObjectURL: vi.fn((blob: Blob) => { downloaded = blob; return "blob:download"; }), revokeObjectURL: vi.fn() });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  render(<ProductionOutputs {...props} />);
  expect(screen.getByText("运行失败 · 已保留现有产物")).toBeVisible();
  expect(screen.getByRole("link", { name: /下载截图/ })).toHaveAttribute("href", "/api/production/runs/prod-1/renders/desktop");
  fireEvent.click(screen.getByRole("button", { name: "下载代码包" }));
  await waitFor(() => expect(click).toHaveBeenCalledOnce());
  expect(getArtifact).toHaveBeenCalledWith("prod-1", "final-source");
  const bytes = await new Promise<ArrayBuffer>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.readAsArrayBuffer(downloaded); });
  const files = unzipSync(new Uint8Array(bytes));
  expect(strFromU8(files["code/src/Page.tsx"]!)).toContain("最终代码");
  expect(JSON.parse(strFromU8(files["run-report.json"]!)).events[0].detail).toBe("no repairable violations");
  expect(strFromU8(files["README.txt"]!)).toContain("运行结束时的代码快照");
  expect(strFromU8(files["README.txt"]!)).toContain("不是独立可运行项目");
});

it("没有代码快照时显示原因且不产生空 ZIP，支持再次下载", async () => {
  getArtifact.mockResolvedValue({ content: { contents: {} } });
  const createObjectURL = vi.fn();
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
  render(<ProductionOutputs {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "下载代码包" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("没有可下载的代码快照");
  expect(createObjectURL).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "下载代码包" })).toBeEnabled();
});
