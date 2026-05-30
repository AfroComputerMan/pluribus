import { memo, useMemo, useState, type ReactNode } from "react";
import type {
  ToolCallMessagePartComponent,
  ToolCallMessagePartStatus,
} from "@assistant-ui/react";
import { WrenchIcon } from "lucide-react";
import {
  ToolFallbackContent,
  ToolFallbackRoot,
  ToolFallbackTrigger,
} from "@/components/assistant-ui/tool-fallback";
import { cn } from "@/lib/utils";

const COMPLETED_STATUS: ToolCallMessagePartStatus = { type: "complete" };

// ---------------------------------------------------------------------------
// Shared primitives (mirrors codex-tool-display.tsx patterns)
// ---------------------------------------------------------------------------

function Section({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("px-0.5", className)}>
      <p className="mb-0.5 text-[10px] text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

function CodePanel({
  text,
  maxLines = 25,
  error,
}: {
  text: string;
  maxLines?: number;
  error?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const lines = text.split("\n");
  const truncated = !expanded && lines.length > maxLines;
  const displayText = truncated ? lines.slice(0, maxLines).join("\n") : text;

  return (
    <div className="font-mono">
      <pre
        className={cn(
          "whitespace-pre-wrap text-[11px] leading-relaxed border-border/50 border-l pl-2",
          error && "text-red-200/90",
        )}
      >
        <code className={cn("bg-transparent p-0", error && "text-red-200/90")}>
          {displayText}
        </code>
      </pre>
      {truncated && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-0.5 text-[10px] text-muted-foreground hover:text-foreground"
        >
          +{lines.length - maxLines} lines
        </button>
      )}
      {expanded && lines.length > maxLines && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="mt-0.5 text-[10px] text-muted-foreground hover:text-foreground"
        >
          collapse
        </button>
      )}
    </div>
  );
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// ---------------------------------------------------------------------------
// PiToolDisplay
//
// Pi tool names are dynamic (native tools + Skills/Extensions), so we render a
// generic args + result view rather than per-tool components. `argsText` is
// populated by pi-provider.ts; `result`/`isError` arrive on tool_end.
// ---------------------------------------------------------------------------

const PiToolDisplayImpl: ToolCallMessagePartComponent = (props) => {
  const argsText = useMemo(() => {
    if (props.argsText) {
      try {
        return JSON.stringify(JSON.parse(props.argsText), null, 2);
      } catch {
        return props.argsText;
      }
    }
    return stringify(props.args);
  }, [props.argsText, props.args]);

  const resultText = useMemo(() => stringify(props.result), [props.result]);
  const isError =
    typeof props.result === "object" &&
    props.result !== null &&
    "isError" in (props.result as Record<string, unknown>)
      ? Boolean((props.result as Record<string, unknown>).isError)
      : false;

  return (
    <ToolFallbackRoot>
      <ToolFallbackTrigger
        toolName={props.toolName || "tool"}
        toolLabel="pi tool"
        leadingIcon={WrenchIcon}
        status={COMPLETED_STATUS}
      />
      <ToolFallbackContent>
        {argsText && argsText !== "{}" && (
          <Section title="arguments">
            <CodePanel text={argsText} maxLines={15} />
          </Section>
        )}
        {resultText && (
          <Section title="result">
            <CodePanel text={resultText} maxLines={20} error={isError} />
          </Section>
        )}
      </ToolFallbackContent>
    </ToolFallbackRoot>
  );
};

export const PiToolDisplay = memo(
  PiToolDisplayImpl,
) as ToolCallMessagePartComponent;
export default PiToolDisplay;
