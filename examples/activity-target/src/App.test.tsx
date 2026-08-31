import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import App from "./App";

const routes = ["/commerce/feed", "/pet/red-packet", "/game/festival"];

afterEach(() => window.history.replaceState({}, "", "/"));

describe("activity page routes", () => {
  it.each(routes)("renders the generated activity page for %s", async (route) => {
    window.history.replaceState({}, "", route);
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector("[data-activity-canvas-root]")).toBeTruthy());
  });
});
