import { memo, useState, type ReactNode } from "react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import {
  FileTextIcon,
  GlobeIcon,
  ListIcon,
  TerminalIcon,
  WrenchIcon,
  BrainIcon,
} from "lucide-react";
import {
  ToolFallbackContent,
  ToolFallbackRoot,
  ToolFallbackTrigger,
} from "@/components/assistant-ui/tool-fallback";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Shared primitives (mirrors claude-tool-display.tsx patterns)
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
  mono = true,
  error,
}: {
  text: string;
  maxLines?: number;
  mono?: boolean;
  error?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const lines = text.split("\n");
  const truncated = !expanded && lines.length > maxLines;
  const displayText = truncated ? lines.slice(0, maxLines).join("\n") : text;

  return (
    <div className={cn(mono && "font-mono")}>
      <pre
        className={cn(
          "whitespace-pre-wrap text-[11px] leading-relaxed border-border/50 border-l pl-2",
          error && "text-red-200/90",
        )}
      >
        {displayText}
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

function safeParseArgs(argsText?: string): Record<string, unknown> | null {
  if (!argsText) return null;
  try {
    return JSON.parse(argsText) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function firstString(...values: unknown[]): string {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v;
  }
  return "";
}

// ---------------------------------------------------------------------------
// Tool renderers per Codex item type
// ---------------------------------------------------------------------------

const FileChangeImpl: ToolCallMessagePartComponent = ({
  argsText,
  status,
}) => {
  const args = safeParseArgs(argsText);
  const path = firstString(args?.path);
  const diff = firstString(args?.diff);
  const fileName = path.split("/").pop() ?? path;

  return (
    <ToolFallbackRoot>
      <ToolFallbackTrigger
        toolName={fileName || "file change"}
        toolLabel="file change"
        leadingIcon={FileTextIcon}
        status={status}
      />
      <ToolFallbackContent>
        {path && (
          <Section title="path">
            <div className="text-muted-foreground/90 break-all font-mono text-[11px]">
              {path}
            </div>
          </Section>
        )}
        {diff && (
          <Section title="diff">
            <CodePanel text={diff} maxLines={30} />
          </Section>
        )}
      </ToolFallbackContent>
    </ToolFallbackRoot>
  );
};

const CommandExecutionImpl: ToolCallMessagePartComponent = ({
  argsText,
  status,
}) => {
  const args = safeParseArgs(argsText);
  const command = firstString(args?.command);
  const output = firstString(args?.output);
  const exitCode =
    typeof args?.exit_code === "number" ? args.exit_code : undefined;
  const title =
    command.length > 90 ? `${command.slice(0, 87)}...` : command || "command";

  return (
    <ToolFallbackRoot>
      <ToolFallbackTrigger
        toolName={title}
        toolLabel="command"
        toolMeta={
          typeof exitCode === "number" ? `exit ${exitCode}` : undefined
        }
        leadingIcon={TerminalIcon}
        status={status}
      />
      <ToolFallbackContent>
        {command && (
          <Section title="command">
            <CodePanel text={`$ ${command}`} maxLines={10} />
          </Section>
        )}
        {output && (
          <Section title="output">
            <CodePanel
              text={output}
              maxLines={28}
              error={exitCode !== undefined && exitCode !== 0}
            />
          </Section>
        )}
      </ToolFallbackContent>
    </ToolFallbackRoot>
  );
};

const WebSearchImpl: ToolCallMessagePartComponent = ({
  argsText,
  status,
}) => {
  const args = safeParseArgs(argsText);
  const query = firstString(args?.query);
  const results = firstString(
    typeof args?.results === "string"
      ? args.results
      : args?.results
        ? JSON.stringify(args.results, null, 2)
        : undefined,
  );

  return (
    <ToolFallbackRoot>
      <ToolFallbackTrigger
        toolName={query || "web search"}
        toolLabel="web search"
        leadingIcon={GlobeIcon}
        status={status}
      />
      <ToolFallbackContent>
        {query && (
          <Section title="query">
            <div className="text-muted-foreground/90 text-[11px]">{query}</div>
          </Section>
        )}
        {results && (
          <Section title="results">
            <CodePanel text={results} maxLines={20} />
          </Section>
        )}
      </ToolFallbackContent>
    </ToolFallbackRoot>
  );
};

const PlanUpdateImpl: ToolCallMessagePartComponent = ({
  argsText,
  status,
}) => {
  const args = safeParseArgs(argsText);
  const plan = firstString(args?.plan, args?.text, args?.content);

  return (
    <ToolFallbackRoot>
      <ToolFallbackTrigger
        toolName="plan update"
        toolLabel="plan"
        leadingIcon={ListIcon}
        status={status}
      />
      <ToolFallbackContent>
        {plan && (
          <Section title="plan">
            <CodePanel text={plan} maxLines={20} mono={false} />
          </Section>
        )}
      </ToolFallbackContent>
    </ToolFallbackRoot>
  );
};

const McpToolCallImpl: ToolCallMessagePartComponent = ({
  argsText,
  status,
}) => {
  const args = safeParseArgs(argsText);
  const toolName = firstString(args?.name, args?.tool_name);
  const toolArgs = args?.args
    ? typeof args.args === "string"
      ? args.args
      : JSON.stringify(args.args, null, 2)
    : "";
  const result = args?.result
    ? typeof args.result === "string"
      ? args.result
      : JSON.stringify(args.result, null, 2)
    : "";

  return (
    <ToolFallbackRoot>
      <ToolFallbackTrigger
        toolName={toolName || "mcp tool"}
        toolLabel="mcp tool"
        leadingIcon={WrenchIcon}
        status={status}
      />
      <ToolFallbackContent>
        {toolArgs && (
          <Section title="arguments">
            <CodePanel text={toolArgs} maxLines={15} />
          </Section>
        )}
        {result && (
          <Section title="result">
            <CodePanel text={result} maxLines={20} />
          </Section>
        )}
      </ToolFallbackContent>
    </ToolFallbackRoot>
  );
};

const ReasoningImpl: ToolCallMessagePartComponent = ({
  argsText,
  status,
}) => {
  const args = safeParseArgs(argsText);
  const text = firstString(args?.text, args?.content, args?.thinking);

  return (
    <ToolFallbackRoot>
      <ToolFallbackTrigger
        toolName="reasoning"
        toolLabel="thinking"
        leadingIcon={BrainIcon}
        status={status}
      />
      <ToolFallbackContent>
        {text && (
          <Section title="reasoning">
            <div className="whitespace-pre-wrap text-[11px] italic text-muted-foreground/80 border-border/50 border-l pl-2">
              {text}
            </div>
          </Section>
        )}
      </ToolFallbackContent>
    </ToolFallbackRoot>
  );
};

// ---------------------------------------------------------------------------
// Dispatcher: routes by toolName (which is the Codex item.type)
// ---------------------------------------------------------------------------

const CodexToolDisplayImpl: ToolCallMessagePartComponent = (props) => {
  switch (props.toolName) {
    case "file_change":
      return <FileChangeImpl {...props} />;
    case "command_execution":
      return <CommandExecutionImpl {...props} />;
    case "web_search":
      return <WebSearchImpl {...props} />;
    case "plan_update":
      return <PlanUpdateImpl {...props} />;
    case "mcp_tool_call":
      return <McpToolCallImpl {...props} />;
    case "reasoning":
      return <ReasoningImpl {...props} />;
    default: {
      // Fallback for unknown item types
      const args = safeParseArgs(props.argsText);
      const summary = args
        ? JSON.stringify(args, null, 2)
        : props.argsText ?? "";
      return (
        <ToolFallbackRoot>
          <ToolFallbackTrigger
            toolName={props.toolName}
            toolLabel="codex"
            leadingIcon={WrenchIcon}
            status={props.status}
          />
          <ToolFallbackContent>
            {summary && (
              <Section title="details">
                <CodePanel text={summary} maxLines={15} />
              </Section>
            )}
          </ToolFallbackContent>
        </ToolFallbackRoot>
      );
    }
  }
};

export const CodexToolDisplay = memo(
  CodexToolDisplayImpl,
) as ToolCallMessagePartComponent;
export default CodexToolDisplay;
