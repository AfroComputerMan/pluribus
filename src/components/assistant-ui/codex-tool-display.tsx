import { memo, type ReactNode } from "react";
import type { ToolCallMessagePartComponent, ToolCallMessagePartStatus } from "@assistant-ui/react";
import {
  MessageSquareIcon,
  FileTextIcon,
  GlobeIcon,
  ListIcon,
  TerminalIcon,
  WrenchIcon,
  BrainIcon,
} from "lucide-react";
import { CodePanel } from "@/components/assistant-ui/code-panel";
import {
  ToolFallbackContent,
  ToolFallbackRoot,
  ToolFallbackTrigger,
} from "@/components/assistant-ui/tool-fallback";
import { cn } from "@/lib/utils";

const COMPLETED_STATUS: ToolCallMessagePartStatus = { type: "complete" };

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

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Tool renderers per Codex item type
// ---------------------------------------------------------------------------

const FileChangeImpl: ToolCallMessagePartComponent = ({
  argsText,
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
        status={COMPLETED_STATUS}
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
}) => {
  const args = safeParseArgs(argsText);
  const command = firstString(args?.command);
  const output = firstString(args?.aggregatedOutput, args?.aggregated_output, args?.output);
  const exitCode = firstNumber(args?.exitCode, args?.exit_code);
  const durationMs = firstNumber(args?.durationMs, args?.duration_ms);
  const commandActions = Array.isArray(args?.commandActions)
    ? args.commandActions
    : Array.isArray(args?.command_actions)
      ? args.command_actions
      : [];
  const title =
    command.length > 90 ? `${command.slice(0, 87)}...` : command || "command";

  return (
    <ToolFallbackRoot>
      <ToolFallbackTrigger
        toolName={title}
        toolLabel="command"
        toolMeta={
          typeof exitCode === "number"
            ? `exit ${exitCode}${typeof durationMs === "number" ? ` | ${durationMs} ms` : ""}`
            : typeof durationMs === "number"
              ? `${durationMs} ms`
              : undefined
        }
        leadingIcon={TerminalIcon}
        status={COMPLETED_STATUS}
      />
      <ToolFallbackContent>
        {command && (
          <Section title="command">
            <CodePanel text={`$ ${command}`} maxLines={10} language="bash" />
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
        {commandActions.length > 0 && (
          <Section title="actions">
            <CodePanel
              text={JSON.stringify(commandActions, null, 2)}
              maxLines={16}
              language="json"
            />
          </Section>
        )}
      </ToolFallbackContent>
    </ToolFallbackRoot>
  );
};

const AgentMessageImpl: ToolCallMessagePartComponent = ({ argsText }) => {
  const args = safeParseArgs(argsText);
  const phase = firstString(args?.phase);
  const text = firstString(args?.text);
  const id = firstString(args?.id);

  return (
    <ToolFallbackRoot>
      <ToolFallbackTrigger
        toolName={phase || "message"}
        toolLabel="agent message"
        toolMeta={id || undefined}
        leadingIcon={MessageSquareIcon}
        status={COMPLETED_STATUS}
      />
      <ToolFallbackContent>
        {text && (
          <Section title="content">
            <CodePanel text={text} maxLines={20} mono={false} />
          </Section>
        )}
        {!text && args && (
          <Section title="details">
            <CodePanel text={JSON.stringify(args, null, 2)} maxLines={20} language="json" />
          </Section>
        )}
      </ToolFallbackContent>
    </ToolFallbackRoot>
  );
};

const WebSearchImpl: ToolCallMessagePartComponent = ({
  argsText,
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
        status={COMPLETED_STATUS}
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
}) => {
  const args = safeParseArgs(argsText);
  const plan = firstString(args?.plan, args?.text, args?.content);

  return (
    <ToolFallbackRoot>
      <ToolFallbackTrigger
        toolName="plan update"
        toolLabel="plan"
        leadingIcon={ListIcon}
        status={COMPLETED_STATUS}
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
        status={COMPLETED_STATUS}
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
}) => {
  const args = safeParseArgs(argsText);
  const text = firstString(args?.text, args?.content, args?.thinking);

  return (
    <ToolFallbackRoot>
      <ToolFallbackTrigger
        toolName="reasoning"
        toolLabel="thinking"
        leadingIcon={BrainIcon}
        status={COMPLETED_STATUS}
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
    case "commandExecution":
      return <CommandExecutionImpl {...props} />;
    case "agent_message":
    case "agentMessage":
      return <AgentMessageImpl {...props} />;
    case "web_search":
    case "webSearch":
      return <WebSearchImpl {...props} />;
    case "plan_update":
    case "planUpdate":
      return <PlanUpdateImpl {...props} />;
    case "mcp_tool_call":
    case "mcpToolCall":
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
            status={COMPLETED_STATUS}
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
