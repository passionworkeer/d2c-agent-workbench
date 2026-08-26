import { Check, GitCompareArrows, WandSparkles } from "lucide-react";
import { useMemo } from "react";
import { diffLines, summarizeDiff, type DiffLine } from "../lib/diff";

export interface DiffViewProps {
  beforeCode: string;
  afterCode: string;
  beforeLabel: string;
  afterLabel: string;
  patches?: string[];
}

export function DiffView({ beforeCode, afterCode, beforeLabel, afterLabel, patches = [] }: DiffViewProps) {
  const lines = useMemo<DiffLine[]>(() => diffLines(beforeCode, afterCode), [beforeCode, afterCode]);
  const { added, removed } = useMemo(() => summarizeDiff(lines), [lines]);
  return (
    <div className="diff-view" data-testid="diff-view">
      <div className="diff-header">
        <span><GitCompareArrows size={13} />{beforeLabel} → {afterLabel}</span>
        <code className="diff-stat">+{added} −{removed}</code>
      </div>
      <pre className="diff-body">
        {lines.map((line, index) => (
          <div
            key={index}
            className={`diff-line ${line.kind}`}
            data-kind={line.kind}
          >
            <span className="diff-marker">
              {line.kind === "add" ? "+" : line.kind === "remove" ? "−" : " "}
            </span>
            <code>{line.text}</code>
          </div>
        ))}
      </pre>
      {patches.length > 0 && (
        <div className="diff-patches">
          <span className="diff-patches-label"><WandSparkles size={11} /> REPAIR PATCHES · 定向修复</span>
          {patches.map((patch) => (
            <div className="diff-patch" key={patch}>
              <Check size={11} /><span>{patch}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
