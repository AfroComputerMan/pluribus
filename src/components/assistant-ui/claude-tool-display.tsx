import { memo, useState } from "react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import {
  ToolFallbackRoot,
  ToolFallbackTrigger,
  ToolFallbackContent,
} from "@/components/assistant-ui/tool-fallback";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

function safeParseArgs(argsText?: string): Record<string, unknown> | null {
  if (!argsText) return null;
  try {
    return JSON.parse(argsText) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function TruncatedText({
  text,
  maxLines = 20,
  className,
}: {
  text: string;
  maxLines?: number;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const lines = text.split("\n");
  const truncated = !expanded && lines.length > maxLines;
  const displayText = truncated ? lines.slice(0, maxLines).join("\n") : text;

  return (
    <div className={className}>
      <pre className="whitespace-pre-wrap text-xs">{displayText}</pre>
      {truncated && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-1 text-xs text-muted-foreground hover:text-foreground"
        >
          Show {lines.length - maxLines} more lines...
        </button>
      )}
      {expanded && lines.length > maxLines && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="mt-1 text-xs text-muted-foreground hover:text-foreground"
        >
          Show less
        </button>
      )}
    </div>
  );
}

function ResultDisplay({ result }: { result?: unknown }) {
  if (result === undefined) return null;
  const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
  return (
    <div className="border-t border-dashed px-4 pt-2">
      <p className="mb-1 text-xs font-semibold text-muted-foreground">Result</p>
      <TruncatedText text={text} maxLines={25} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Read tool
// ---------------------------------------------------------------------------

const ReadToolImpl: ToolCallMessagePartComponent = ({ toolName, argsText, result, status }) => {
  const args = safeParseArgs(argsText);
  const filePath = (args?.file_path as string) ?? "";
  const fileName = filePath.split("/").pop() ?? filePath;
  const label = fileName || toolName;

  return (
    <ToolFallbackRoot>
      <ToolFallbackTrigger toolName={`Read: ${label}`} status={status} />
      <ToolFallbackContent>
        {filePath && (
          <div className="px-4 text-xs text-muted-foreground font-mono">{filePath}</div>
        )}
        <ResultDisplay result={result} />
      </ToolFallbackContent>
    </ToolFallbackRoot>
  );
};

// ---------------------------------------------------------------------------
// Edit tool
// ---------------------------------------------------------------------------

const EditToolImpl: ToolCallMessagePartComponent = ({ toolName, argsText, result, status }) => {
  const args = safeParseArgs(argsText);
  const filePath = (args?.file_path as string) ?? "";
  const fileName = filePath.split("/").pop() ?? filePath;
  const oldStr = (args?.old_string as string) ?? "";
  const newStr = (args?.new_string as string) ?? "";
  const label = fileName || toolName;

  return (
    <ToolFallbackRoot>
      <ToolFallbackTrigger toolName={`Edit: ${label}`} status={status} />
      <ToolFallbackContent>
        {filePath && (
          <div className="px-4 text-xs text-muted-foreground font-mono">{filePath}</div>
        )}
        {(oldStr || newStr) && (
          <div className="mx-4 mt-1 space-y-1 rounded border p-2 text-xs font-mono">
            {oldStr && (
              <div className="text-red-500/80">
                <span className="mr-1 select-none font-bold">-</span>
                <pre className="inline whitespace-pre-wrap">{oldStr}</pre>
              </div>
            )}
            {newStr && (
              <div className="text-green-500/80">
                <span className="mr-1 select-none font-bold">+</span>
                <pre className="inline whitespace-pre-wrap">{newStr}</pre>
              </div>
            )}
          </div>
        )}
        <ResultDisplay result={result} />
      </ToolFallbackContent>
    </ToolFallbackRoot>
  );
};

// ---------------------------------------------------------------------------
// Write tool
// ---------------------------------------------------------------------------

const WriteToolImpl: ToolCallMessagePartComponent = ({ toolName, argsText, result, status }) => {
  const args = safeParseArgs(argsText);
  const filePath = (args?.file_path as string) ?? "";
  const content = (args?.content as string) ?? "";
  const fileName = filePath.split("/").pop() ?? filePath;
  const label = fileName || toolName;

  return (
    <ToolFallbackRoot>
      <ToolFallbackTrigger toolName={`Write: ${label}`} status={status} />
      <ToolFallbackContent>
        {filePath && (
          <div className="px-4 text-xs text-muted-foreground font-mono">{filePath}</div>
        )}
        {content && (
          <div className="px-4">
            <TruncatedText text={content} maxLines={15} className="font-mono" />
          </div>
        )}
        <ResultDisplay result={result} />
      </ToolFallbackContent>
    </ToolFallbackRoot>
  );
};

// ---------------------------------------------------------------------------
// Bash tool
// ---------------------------------------------------------------------------

const BashToolImpl: ToolCallMessagePartComponent = ({ toolName, argsText, result, status }) => {
  const args = safeParseArgs(argsText);
  const command = (args?.command as string) ?? "";
  const description = (args?.description as string) ?? "";
  const label = description || (command.length > 60 ? command.slice(0, 57) + "..." : command) || toolName;

  return (
    <ToolFallbackRoot>
      <ToolFallbackTrigger toolName={`Bash: ${label}`} status={status} />
      <ToolFallbackContent>
        {command && (
          <div className="mx-4 rounded bg-muted/50 px-3 py-2 font-mono text-xs">
            <span className="mr-1 select-none text-muted-foreground">$</span>
            {command}
          </div>
        )}
        <ResultDisplay result={result} />
      </ToolFallbackContent>
    </ToolFallbackRoot>
  );
};

// ---------------------------------------------------------------------------
// Grep tool
// ---------------------------------------------------------------------------

const GrepToolImpl: ToolCallMessagePartComponent = ({ toolName, argsText, result, status }) => {
  const args = safeParseArgs(argsText);
  const pattern = (args?.pattern as string) ?? "";
  const path = (args?.path as string) ?? "";
  const label = pattern
    ? `Grep: "${pattern}"${path ? ` in ${path.split("/").pop()}` : ""}`
    : toolName;

  return (
    <ToolFallbackRoot>
      <ToolFallbackTrigger toolName={label} status={status} />
      <ToolFallbackContent>
        {(pattern || path) && (
          <div className="px-4 text-xs text-muted-foreground">
            {pattern && <span className="font-mono">/{pattern}/</span>}
            {path && <span className="ml-2 font-mono">{path}</span>}
          </div>
        )}
        <ResultDisplay result={result} />
      </ToolFallbackContent>
    </ToolFallbackRoot>
  );
};

// ---------------------------------------------------------------------------
// Glob tool
// ---------------------------------------------------------------------------

const GlobToolImpl: ToolCallMessagePartComponent = ({ toolName, argsText, result, status }) => {
  const args = safeParseArgs(argsText);
  const pattern = (args?.pattern as string) ?? "";
  const label = pattern ? `Glob: ${pattern}` : toolName;

  return (
    <ToolFallbackRoot>
      <ToolFallbackTrigger toolName={label} status={status} />
      <ToolFallbackContent>
        <ResultDisplay result={result} />
      </ToolFallbackContent>
    </ToolFallbackRoot>
  );
};

// ---------------------------------------------------------------------------
// WebSearch tool
// ---------------------------------------------------------------------------

const WebSearchToolImpl: ToolCallMessagePartComponent = ({ toolName, argsText, result, status }) => {
  const args = safeParseArgs(argsText);
  const query = (args?.query as string) ?? "";
  const label = query ? `Search: "${query}"` : toolName;

  return (
    <ToolFallbackRoot>
      <ToolFallbackTrigger toolName={label} status={status} />
      <ToolFallbackContent>
        <ResultDisplay result={result} />
      </ToolFallbackContent>
    </ToolFallbackRoot>
  );
};

// ---------------------------------------------------------------------------
// WebFetch tool
// ---------------------------------------------------------------------------

const WebFetchToolImpl: ToolCallMessagePartComponent = ({ toolName, argsText, result, status }) => {
  const args = safeParseArgs(argsText);
  const url = (args?.url as string) ?? "";
  let displayUrl = url;
  try {
    const parsed = new URL(url);
    displayUrl = parsed.hostname + (parsed.pathname !== "/" ? parsed.pathname : "");
  } catch {
    // keep raw url
  }
  const label = displayUrl ? `Fetch: ${displayUrl}` : toolName;

  return (
    <ToolFallbackRoot>
      <ToolFallbackTrigger toolName={label} status={status} />
      <ToolFallbackContent>
        {url && (
          <div className="px-4 text-xs text-muted-foreground font-mono break-all">{url}</div>
        )}
        <ResultDisplay result={result} />
      </ToolFallbackContent>
    </ToolFallbackRoot>
  );
};

// ---------------------------------------------------------------------------
// Task tool (basic renderer — no live sub-agent streaming)
// ---------------------------------------------------------------------------

const TaskToolImpl: ToolCallMessagePartComponent = ({ toolName, argsText, result, status }) => {
  const args = safeParseArgs(argsText);
  const description = (args?.description as string) ?? "";
  const subagentType = (args?.subagent_type as string) ?? "";
  const prompt = (args?.prompt as string) ?? "";
  const label = description || toolName;

  return (
    <ToolFallbackRoot>
      <ToolFallbackTrigger toolName={`Task: ${label}`} status={status} />
      <ToolFallbackContent>
        <div className="space-y-1 px-4 text-xs">
          {subagentType && (
            <div>
              <span className="text-muted-foreground">Agent: </span>
              <span className={cn(
                "rounded px-1.5 py-0.5 font-medium",
                "bg-muted text-muted-foreground",
              )}>
                {subagentType}
              </span>
            </div>
          )}
          {prompt && (
            <div className="text-muted-foreground">
              <TruncatedText text={prompt} maxLines={5} />
            </div>
          )}
        </div>
        <ResultDisplay result={result} />
      </ToolFallbackContent>
    </ToolFallbackRoot>
  );
};

// ---------------------------------------------------------------------------
// Memoized exports
// ---------------------------------------------------------------------------

export const ReadTool = memo(ReadToolImpl) as ToolCallMessagePartComponent;
export const EditTool = memo(EditToolImpl) as ToolCallMessagePartComponent;
export const WriteTool = memo(WriteToolImpl) as ToolCallMessagePartComponent;
export const BashTool = memo(BashToolImpl) as ToolCallMessagePartComponent;
export const GrepTool = memo(GrepToolImpl) as ToolCallMessagePartComponent;
export const GlobTool = memo(GlobToolImpl) as ToolCallMessagePartComponent;
export const WebSearchTool = memo(WebSearchToolImpl) as ToolCallMessagePartComponent;
export const WebFetchTool = memo(WebFetchToolImpl) as ToolCallMessagePartComponent;
export const TaskTool = memo(TaskToolImpl) as ToolCallMessagePartComponent;
