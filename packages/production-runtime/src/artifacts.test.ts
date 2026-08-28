import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileArtifactStore } from "./index";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("FileArtifactStore", () => {
  it("writes immutable versioned artifacts under one run directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "d2c-artifacts-"));
    roots.push(root);
    const store = await FileArtifactStore.create(root, "run-1");
    const first = await store.writeJson("spec", "activity-spec", { version: 1 });
    const second = await store.writeJson("spec", "activity-spec", { version: 2 });
    expect(first.path).not.toBe(second.path);
    expect(JSON.parse(await readFile(first.absolutePath, "utf8"))).toEqual({ version: 1 });
    expect(await store.list()).toHaveLength(2);
  });

  it("rejects unsafe run and artifact names", async () => {
    const root = await mkdtemp(join(tmpdir(), "d2c-artifacts-"));
    roots.push(root);
    await expect(FileArtifactStore.create(root, "../outside")).rejects.toThrow(/run id/);
    const store = await FileArtifactStore.create(root, "run-1");
    await expect(store.writeJson("../secret", "x", {})).rejects.toThrow(/artifact/);
  });
});
