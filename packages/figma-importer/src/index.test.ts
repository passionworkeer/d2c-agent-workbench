import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { BundleError, parseFigmaBundle } from "./index";

function json(value: unknown): Uint8Array {
  return strToU8(JSON.stringify(value));
}

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

function validArchive(): Uint8Array {
  return zipSync({
    "manifest.json": json({
      protocolVersion: "1.0",
      name: "Product Grid",
      viewport: { width: 1440, height: 900 },
    }),
    "design.json": json({ nodes: [validNode] }),
    "variables.json": json([]),
    "components.json": json([]),
    "preview/root.svg": strToU8("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>"),
  });
}

function archiveWith(extra: Record<string, Uint8Array>): Uint8Array {
  const base = {
    "manifest.json": json({
      protocolVersion: "1.0",
      name: "Product Grid",
      viewport: { width: 1440, height: 900 },
    }),
    "design.json": json({ nodes: [validNode] }),
    "variables.json": json([]),
    "components.json": json([]),
  };
  return zipSync({ ...base, ...extra });
}

describe("parseFigmaBundle", () => {
  it("parses and validates a complete bundle", () => {
    const result = parseFigmaBundle(validArchive());

    expect(result.manifest.name).toBe("Product Grid");
    expect(result.nodes[0]?.layoutMode).toBe("VERTICAL");
    expect(result.previewUrl).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it("drops oversized previews instead of keeping them in memory", () => {
    const oversized = new Uint8Array(2 * 1024 * 1024 + 1);
    const result = parseFigmaBundle(archiveWith({ "preview/root.svg": oversized }));

    expect(result.previewUrl).toBeUndefined();
  });

  it("rejects non-zip payloads with a stable message", () => {
    expect(() => parseFigmaBundle(new Uint8Array([0x00, 0x01, 0xff])))
      .toThrow(new BundleError("无效的 ZIP 压缩包").message);
  });

  it.each([
    ["../escape.txt"],
    ["..\\evil.txt"],
    ["\\server\\share\\evil.txt"],
    ["\\evil\\file.txt"],
    ["/abs/path.txt"],
    ["C:/evil.txt"],
    ["c:\\evil.txt"],
    ["a/../../evil.txt"],
  ])("rejects unsafe path %s", (path) => {
    const archive = zipSync({
      [path]: strToU8("unsafe"),
      "manifest.json": json({}),
    });

    expect(() => parseFigmaBundle(archive)).toThrow(BundleError);
    expect(() => parseFigmaBundle(archive)).toThrow("不安全的压缩包路径");
  });

  it("rejects duplicate entry names", () => {
    // zipSync 的对象键无法重复，手工构造两个同名 STORED entry 的最小 ZIP。
    const name = "manifest.json";
    const payload = strToU8("{}");
    const nameBytes = Buffer.from(name, "utf8");

    const localEntry = (offset: number) => {
      const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50, 0);
      header.writeUInt16LE(20, 4);
      header.writeUInt16LE(0, 6);
      header.writeUInt16LE(0, 8);
      header.writeUInt32LE(0, 14);
      header.writeUInt32LE(payload.byteLength, 18);
      header.writeUInt32LE(payload.byteLength, 22);
      header.writeUInt16LE(nameBytes.length, 26);
      header.writeUInt16LE(0, 28);
      return Buffer.concat([header, nameBytes, Buffer.from(payload)]);
    };
    const first = localEntry(0);
    const second = localEntry(first.length);
    const cdEntry = (offset: number) => {
      const header = Buffer.alloc(46);
      header.writeUInt32LE(0x02014b50, 0);
      header.writeUInt16LE(20, 4);
      header.writeUInt16LE(20, 6);
      header.writeUInt16LE(0, 8);
      header.writeUInt16LE(0, 10);
      header.writeUInt32LE(0, 16);
      header.writeUInt32LE(payload.byteLength, 20);
      header.writeUInt32LE(payload.byteLength, 24);
      header.writeUInt16LE(nameBytes.length, 28);
      header.writeUInt32LE(offset, 42);
      return Buffer.concat([header, nameBytes]);
    };
    const cd = Buffer.concat([cdEntry(0), cdEntry(first.length)]);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(2, 8);
    eocd.writeUInt16LE(2, 10);
    eocd.writeUInt32LE(cd.length, 12);
    eocd.writeUInt32LE(first.length + second.length, 16);

    const archive = new Uint8Array(
      Buffer.concat([first, second, cd, eocd]),
    );

    expect(() => parseFigmaBundle(archive)).toThrow("压缩包存在重名文件");
  });

  it("rejects whitelisted entries that exceed the declared uncompressed budget before extraction", () => {
    // 炸弹必须落在白名单路径内才会进入预算检查；白名单外的 entry 在解压前即被丢弃。
    const bomb = new Uint8Array(21 * 1024 * 1024);
    const archive = zipSync({ "design.json": bomb });

    expect(() => parseFigmaBundle(archive)).toThrow("压缩包解压后超过 20MB 上限");
  });

  it("rejects deep nesting with a stable message", () => {
    const nodeJson = (id: string, inner: string) =>
      `{"id":"${id}","name":"${id}","type":"FRAME","width":1,"height":1,"layoutMode":"NONE","layoutSizingHorizontal":"FIXED","layoutSizingVertical":"FIXED","children":[${inner}]}`;
    let deep = nodeJson("leaf", "");
    for (let i = 0; i < 5000; i += 1) deep = nodeJson(`n${i}`, deep);
    const archive = zipSync({
      "manifest.json": json({ protocolVersion: "1.0", name: "deep", viewport: { width: 1, height: 1 } }),
      "design.json": strToU8(`{"nodes":[${deep}]}`),
      "variables.json": json([]),
      "components.json": json([]),
    });

    expect(() => parseFigmaBundle(archive)).toThrow("设计节点嵌套层级过深");
  });

  it("rejects missing required files", () => {
    const archive = zipSync({ "foo.txt": strToU8("hello") });

    expect(() => parseFigmaBundle(archive)).toThrow("缺少必需文件：manifest.json");
  });

  it("rejects invalid JSON payloads", () => {
    const archive = zipSync({
      "manifest.json": strToU8("not json"),
      "design.json": json({ nodes: [validNode] }),
      "variables.json": json([]),
      "components.json": json([]),
    });

    expect(() => parseFigmaBundle(archive)).toThrow("JSON 文件格式错误：manifest.json");
  });

  it("rejects schema mismatches with the offending path", () => {
    const archive = zipSync({
      "manifest.json": json({ protocolVersion: "1.0", name: "x", viewport: { width: 1, height: 1 } }),
      "design.json": json({ nope: true }),
      "variables.json": json([]),
      "components.json": json([]),
    });

    expect(() => parseFigmaBundle(archive)).toThrow("资产包结构校验失败：nodes");
  });
});
