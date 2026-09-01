import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LiveCodePreview } from "./LiveCodePreview";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("交互模式执行页面事件，检查模式基于真实 DOM 框选，并随滚动更新与清除", async () => {
  const onSelect = vi.fn();
  const props = { url: "/production-previews/index.html?run=prod-test", width: 390, height: 867, onSelect };
  const view = render(<LiveCodePreview {...props} inspect={false} />);
  const frame = screen.getByTitle("真实代码交互预览") as HTMLIFrameElement;
  const doc = frame.contentDocument!;
  doc.open();
  doc.write('<html><body><main data-d2c-ready="true"><button data-d2c-node-id="buy">购买</button></main></body></html>');
  doc.close();
  const button = doc.querySelector("button")!;
  const businessClick = vi.fn();
  button.addEventListener("click", businessClick);
  let top = 32;
  vi.spyOn(button, "getBoundingClientRect").mockImplementation(() => ({ x: 20, y: top, width: 120, height: 44, left: 20, top, right: 140, bottom: top + 44, toJSON() {} }));
  fireEvent.load(frame);
  await waitFor(() => expect(document.querySelector(".live-code-preview")).toHaveAttribute("data-ready", "true"));
  fireEvent.click(button);
  expect(businessClick).toHaveBeenCalledTimes(1);
  expect(document.querySelector(".live-node-outline")).toBeNull();

  view.rerender(<LiveCodePreview {...props} inspect />);
  fireEvent.mouseMove(button);
  expect(document.querySelector(".live-node-outline.hovered")).toHaveAttribute("data-node-id", "buy");
  fireEvent.click(button);
  expect(businessClick).toHaveBeenCalledTimes(1);
  expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ id: "buy", tag: "button", x: 20, y: 32, width: 120, height: 44 }));
  expect(document.querySelector(".live-node-outline.selected")).toHaveStyle({ left: "20px", top: "32px", width: "120px", height: "44px" });

  top = 10;
  fireEvent.scroll(doc);
  expect(document.querySelector(".live-node-outline.selected")).toHaveStyle({ top: "10px" });
  fireEvent.keyDown(doc, { key: "Escape" });
  expect(document.querySelector(".live-node-outline.selected")).toBeNull();
  expect(onSelect).toHaveBeenLastCalledWith(null);
  button.disabled = true;
  fireEvent.pointerDown(button);
  expect(document.querySelector(".live-node-outline.selected")).toHaveAttribute("data-node-id", "buy");
  await act(async () => { button.remove(); });
  expect(document.querySelector(".live-node-outline.selected")).toBeNull();
  expect(onSelect).toHaveBeenLastCalledWith(null);
});
