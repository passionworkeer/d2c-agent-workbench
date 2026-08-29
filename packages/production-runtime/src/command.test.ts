import { describe, expect, it } from "vitest";
import { runAllowedCommand } from "./index";

describe("runAllowedCommand", () => {
  it("captures exit code, duration and bounded output without a shell", async () => {
    const command = [process.execPath, "-e", "console.log('ok')"];
    const result = await runAllowedCommand(command, {
      cwd: process.cwd(),
      allowedCommands: [command],
      timeoutMs: 5_000,
      maxOutputBytes: 1024,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("ok\n");
    expect(result.timedOut).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("rejects commands that are not explicitly allowed", async () => {
    await expect(runAllowedCommand([process.execPath, "-e", "process.exit(0)"], {
      cwd: process.cwd(),
      allowedCommands: [["pnpm", "build"]],
    })).rejects.toThrow(/allowlist/);
  });

  it("terminates commands that exceed their timeout", async () => {
    const command = [process.execPath, "-e", "setTimeout(() => {}, 10000)"];
    const result = await runAllowedCommand(command, {
      cwd: process.cwd(), allowedCommands: [command], timeoutMs: 100, maxOutputBytes: 1024,
    });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
  });
});
