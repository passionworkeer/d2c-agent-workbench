// 简单 LCS 行 diff：对两个字符串数组跑最长公共子序列，输出带 add/remove/equal 标记的序列。
// 复杂度 O(n·m) 对 demo 体量（几十行 tokens.css）足够；不追求 Myers 算法以保持代码量小。
//
// split 规约：空串视为 0 行；末尾 \n 会产生一个空串代表「行末换行」，我们丢弃以保证行数与文本语义一致。

function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export type DiffLineKind = "equal" | "add" | "remove";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

export function diffLines(before: string, after: string): DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);
  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS length of a[i..n-1] × b[j..m-1]
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    const row = dp[i]!;
    const rowNext = dp[i + 1]!;
    for (let j = m - 1; j >= 0; j -= 1) {
      if (a[i] === b[j]) row[j] = rowNext[j + 1]! + 1;
      else row[j] = Math.max(rowNext[j]!, row[j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const row = dp[i]!;
    const rowNext = dp[i + 1]!;
    if (a[i] === b[j]) {
      out.push({ kind: "equal", text: a[i] ?? "" });
      i += 1;
      j += 1;
    } else if ((rowNext[j] ?? 0) >= (row[j + 1] ?? 0)) {
      out.push({ kind: "remove", text: a[i] ?? "" });
      i += 1;
    } else {
      out.push({ kind: "add", text: b[j] ?? "" });
      j += 1;
    }
  }
  while (i < n) out.push({ kind: "remove", text: a[i++] ?? "" });
  while (j < m) out.push({ kind: "add", text: b[j++] ?? "" });
  return out;
}

export function summarizeDiff(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.kind === "add") added += 1;
    else if (line.kind === "remove") removed += 1;
  }
  return { added, removed };
}
