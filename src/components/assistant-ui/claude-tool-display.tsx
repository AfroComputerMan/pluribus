import { memo, useMemo, useState, type FC, type ReactNode } from "react";
import type { ToolCallMessagePartComponent, ToolCallMessagePartStatus } from "@assistant-ui/react";
import {
  AlertCircleIcon,
  BotIcon,
  FilePlusIcon,
  FileTextIcon,
  FolderIcon,
  GlobeIcon,
  PencilIcon,
  SearchIcon,
  TerminalIcon,
  type LucideIcon,
} from "lucide-react";
import hljs from "highlight.js/lib/core";
import type { LanguageFn } from "highlight.js";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import graphql from "highlight.js/lib/languages/graphql";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import less from "highlight.js/lib/languages/less";
import lua from "highlight.js/lib/languages/lua";
import makefile from "highlight.js/lib/languages/makefile";
import markdown from "highlight.js/lib/languages/markdown";
import objectivec from "highlight.js/lib/languages/objectivec";
import perl from "highlight.js/lib/languages/perl";
import php from "highlight.js/lib/languages/php";
import powershell from "highlight.js/lib/languages/powershell";
import python from "highlight.js/lib/languages/python";
import r from "highlight.js/lib/languages/r";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scala from "highlight.js/lib/languages/scala";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import {
  ToolFallbackContent,
  ToolFallbackRoot,
  ToolFallbackTrigger,
} from "@/components/assistant-ui/tool-fallback";
import { cn } from "@/lib/utils";

const REGISTERED_LANGUAGES: Array<[string, LanguageFn]> = [
  ["bash", bash],
  ["c", c],
  ["cpp", cpp],
  ["csharp", csharp],
  ["css", css],
  ["diff", diff],
  ["dockerfile", dockerfile],
  ["go", go],
  ["graphql", graphql],
  ["ini", ini],
  ["java", java],
  ["javascript", javascript],
  ["json", json],
  ["kotlin", kotlin],
  ["less", less],
  ["lua", lua],
  ["makefile", makefile],
  ["markdown", markdown],
  ["objectivec", objectivec],
  ["perl", perl],
  ["php", php],
  ["powershell", powershell],
  ["python", python],
  ["r", r],
  ["ruby", ruby],
  ["rust", rust],
  ["scala", scala],
  ["sql", sql],
  ["swift", swift],
  ["typescript", typescript],
  ["xml", xml],
  ["yaml", yaml],
];

for (const [name, language] of REGISTERED_LANGUAGES) {
  if (!hljs.getLanguage(name)) {
    hljs.registerLanguage(name, language);
  }
}

const AUTO_DETECT_LANGUAGES = REGISTERED_LANGUAGES.map(([name]) => name);

type HighlightLanguage = (typeof AUTO_DETECT_LANGUAGES)[number];

const EXTENSION_LANGUAGE_MAP: Record<string, HighlightLanguage> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  swift: "swift",
  php: "php",
  phtml: "php",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  hxx: "cpp",
  cs: "csharp",
  m: "objectivec",
  mm: "objectivec",
  scala: "scala",
  sql: "sql",
  psql: "sql",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "bash",
  ps1: "powershell",
  bat: "powershell",
  cmd: "powershell",
  json: "json",
  jsonc: "json",
  json5: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  ini: "ini",
  conf: "ini",
  cfg: "ini",
  properties: "ini",
  xml: "xml",
  html: "xml",
  htm: "xml",
  xhtml: "xml",
  svg: "xml",
  css: "css",
  scss: "css",
  less: "less",
  md: "markdown",
  mdx: "markdown",
  markdown: "markdown",
  gql: "graphql",
  graphql: "graphql",
  dockerfile: "dockerfile",
  mk: "makefile",
  lua: "lua",
  pl: "perl",
  pm: "perl",
  r: "r",
};

function safeParseArgs(argsText?: string): Record<string, unknown> | null {
  if (!argsText) return null;
  try {
    return JSON.parse(argsText) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function maybeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function detectLanguageFromPath(path?: string): HighlightLanguage | undefined {
  if (!path) return undefined;

  const normalized = path.trim().toLowerCase();
  if (!normalized) return undefined;

  const filename = normalized.split("/").pop() ?? normalized;
  if (filename === "dockerfile") return "dockerfile";
  if (filename === "makefile") return "makefile";

  const parts = filename.split(".");
  if (parts.length < 2) return undefined;

  const extension = parts[parts.length - 1] ?? "";
  return EXTENSION_LANGUAGE_MAP[extension];
}

function detectLanguageFromCommand(command: string): HighlightLanguage | undefined {
  const fileMatches = command.match(/[A-Za-z0-9_./-]+\.[A-Za-z0-9_+-]+/g);
  if (!fileMatches?.length) return undefined;

  const lastMatch = fileMatches[fileMatches.length - 1];
  return detectLanguageFromPath(lastMatch);
}

function inferTextLanguage(text: string): HighlightLanguage | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;

  if ((trimmed.startsWith("{") || trimmed.startsWith("[")) && maybeParseJson(trimmed) !== trimmed) {
    return "json";
  }

  if (trimmed.startsWith("diff --git") || /^@@\s/m.test(trimmed)) {
    return "diff";
  }

  return undefined;
}

function highlightText(text: string, language?: HighlightLanguage): string {
  if (!text) return "";

  if (language && hljs.getLanguage(language)) {
    try {
      return hljs.highlight(text, { language, ignoreIllegals: true }).value;
    } catch {
      // Fallback to auto-detection.
    }
  }

  try {
    return hljs.highlightAuto(text, AUTO_DETECT_LANGUAGES).value;
  } catch {
    return text;
  }
}

function domNodesToReact(nodes: NodeList): ReactNode[] {
  const result: ReactNode[] = [];
  let key = 0;
  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      if (text) result.push(text);
    } else if (node.nodeType === Node.ELEMENT_NODE && node.nodeName === "SPAN") {
      const el = node as Element;
      result.push(
        <span key={key} className={el.getAttribute("class") ?? undefined}>
          {domNodesToReact(el.childNodes)}
        </span>,
      );
    } else {
      // Non-span element — render its text content only, never its markup
      const text = node.textContent ?? "";
      if (text) result.push(text);
    }
    key++;
  }
  return result;
}

function parseHljsHtml(html: string): ReactNode {
  if (!html) return null;
  const doc = new DOMParser().parseFromString(`<span>${html}</span>`, "text/html");
  const root = doc.body.firstChild;
  if (!root) return null;
  return domNodesToReact(root.childNodes);
}

function HighlightedCode({
  text,
  language,
  error,
}: {
  text: string;
  language?: HighlightLanguage;
  error?: boolean;
}) {
  const nodes = useMemo(() => parseHljsHtml(highlightText(text, language)), [text, language]);

  return (
    <pre className="whitespace-pre-wrap text-[11px] leading-relaxed font-mono">
      <code className={cn("hljs", "bg-transparent p-0", error && "text-red-200/90")}>
        {nodes}
      </code>
    </pre>
  );
}

function TruncatedText({
  text,
  maxLines = 20,
  language,
  error,
  className,
}: {
  text: string;
  maxLines?: number;
  language?: HighlightLanguage;
  error?: boolean;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const lines = text.split("\n");
  const truncated = !expanded && lines.length > maxLines;
  const displayText = truncated ? lines.slice(0, maxLines).join("\n") : text;

  return (
    <div className={className}>
      <HighlightedCode text={displayText} language={language} error={error} />
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
  language,
  error,
}: {
  text: string;
  maxLines?: number;
  language?: HighlightLanguage;
  error?: boolean;
}) {
  return (
    <div className="font-mono">
      <TruncatedText
        text={text}
        maxLines={maxLines}
        language={language}
        error={error}
        className="border-border/50 border-l pl-2"
      />
    </div>
  );
}

function ToolErrorNote({ status }: { status?: ToolCallMessagePartStatus }) {
  if (status?.type !== "incomplete") return null;
  const text =
    typeof status.error === "string"
      ? status.error
      : status.error
        ? JSON.stringify(status.error)
        : status.reason === "cancelled"
          ? "Cancelled"
          : "Tool failed";

  return (
    <div className="mt-0.5 flex items-start gap-1 text-[10px] text-red-200/85">
      <AlertCircleIcon className="mt-[1px] size-3 shrink-0" />
      <span className="truncate">{text}</span>
    </div>
  );
}

function ToolFrame({
  status,
  icon,
  label,
  title,
  meta,
  children,
}: {
  status?: ToolCallMessagePartStatus;
  icon: LucideIcon;
  label: string;
  title: string;
  meta?: string;
  children: ReactNode;
}) {
  return (
    <ToolFallbackRoot>
      <ToolFallbackTrigger
        toolName={title}
        toolLabel={label}
        toolMeta={meta}
        leadingIcon={icon}
        status={status}
      />
      <ToolFallbackContent>
        <ToolErrorNote status={status} />
        {children}
      </ToolFallbackContent>
    </ToolFallbackRoot>
  );
}

function defaultResultToText(result: unknown): string {
  if (result === undefined || result === null) return "";
  const normalized = typeof result === "string" ? maybeParseJson(result) : result;

  if (typeof normalized === "string") return normalized;

  const objectResult = asObject(normalized);
  if (objectResult) {
    const simplified: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(objectResult)) {
      if (["type", "mime", "metadata"].includes(key)) continue;
      simplified[key] = value;
    }
    return JSON.stringify(simplified, null, 2);
  }

  return JSON.stringify(normalized, null, 2);
}

function GenericResult({
  result,
  title = "result",
  languageHint,
}: {
  result?: unknown;
  title?: string;
  languageHint?: HighlightLanguage;
}) {
  if (result === undefined || result === null) return null;
  const text = defaultResultToText(result);
  if (!text) return null;

  const inferredLanguage = languageHint ?? inferTextLanguage(text);

  return (
    <Section title={title}>
      <CodePanel text={text} language={inferredLanguage} />
    </Section>
  );
}

const PathLine = ({ path }: { path: string }) => (
  <div className="text-muted-foreground/90 break-all font-mono text-[11px]">{path}</div>
);

const ReadToolImpl: ToolCallMessagePartComponent = ({ argsText, result, status }) => {
  const args = safeParseArgs(argsText);
  const filePath = firstText(args?.file_path, args?.path);
  const offset = typeof args?.offset === "number" ? args.offset : undefined;
  const limit = typeof args?.limit === "number" ? args.limit : undefined;
  const fileName = filePath.split("/").pop() ?? filePath;

  const normalized = typeof result === "string" ? maybeParseJson(result) : result;
  const objectResult = asObject(normalized);
  const fileResult = asObject(objectResult?.file) ?? objectResult;
  const content = firstText(fileResult?.content, objectResult?.content);

  const startLine =
    typeof fileResult?.startLine === "number"
      ? fileResult.startLine
      : typeof offset === "number"
        ? offset + 1
        : undefined;
  const lineCount =
    typeof fileResult?.numLines === "number"
      ? fileResult.numLines
      : typeof limit === "number"
        ? limit
        : undefined;
  const endLine =
    typeof startLine === "number" && typeof lineCount === "number"
      ? startLine + Math.max(lineCount - 1, 0)
      : undefined;
  const lineMeta =
    typeof startLine === "number" && typeof endLine === "number"
      ? `${startLine}-${endLine}`
      : undefined;
  const contentLanguage = detectLanguageFromPath(filePath);

  return (
    <ToolFrame status={status} icon={FileTextIcon} label="read" title={fileName || "file"} meta={lineMeta}>
      {filePath && (
        <Section title="path">
          <PathLine path={filePath} />
        </Section>
      )}
      {content ? (
        <Section title={lineMeta ? `lines ${lineMeta}` : "contents"}>
          <CodePanel text={content} maxLines={30} language={contentLanguage} />
        </Section>
      ) : (
        <GenericResult result={result} languageHint={contentLanguage} />
      )}
    </ToolFrame>
  );
};

const EditToolImpl: ToolCallMessagePartComponent = ({ argsText, result, status }) => {
  const args = safeParseArgs(argsText);
  const filePath = firstText(args?.file_path, args?.path);
  const fileName = filePath.split("/").pop() ?? filePath;
  const oldText = firstText(args?.old_string, args?.oldText);
  const newText = firstText(args?.new_string, args?.newText);

  const diffText = [
    ...oldText.split("\n").map((line) => `- ${line}`),
    ...newText.split("\n").map((line) => `+ ${line}`),
  ]
    .join("\n")
    .trim();

  return (
    <ToolFrame status={status} icon={PencilIcon} label="edit" title={fileName || "file"}>
      {filePath && (
        <Section title="path">
          <PathLine path={filePath} />
        </Section>
      )}
      {diffText && (
        <Section title="diff">
          <CodePanel text={diffText} maxLines={24} language="diff" />
        </Section>
      )}
      {!diffText && <GenericResult result={result} />}
    </ToolFrame>
  );
};

const WriteToolImpl: ToolCallMessagePartComponent = ({ argsText, result, status }) => {
  const args = safeParseArgs(argsText);
  const filePath = firstText(args?.file_path, args?.path);
  const fileName = filePath.split("/").pop() ?? filePath;
  const content = firstText(args?.content);
  const contentLanguage = detectLanguageFromPath(filePath);

  return (
    <ToolFrame status={status} icon={FilePlusIcon} label="write" title={fileName || "file"}>
      {filePath && (
        <Section title="path">
          <PathLine path={filePath} />
        </Section>
      )}
      {content && (
        <Section title="contents">
          <CodePanel text={content} maxLines={20} language={contentLanguage} />
        </Section>
      )}
      <GenericResult result={result} languageHint={contentLanguage} />
    </ToolFrame>
  );
};

const BashToolImpl: ToolCallMessagePartComponent = ({ argsText, result, status }) => {
  const args = safeParseArgs(argsText);
  const command = firstText(args?.command, args?.cmd);
  const description = firstText(args?.description);
  const title =
    description ||
    (command.length > 90 ? `${command.slice(0, 87)}...` : command) ||
    "shell";

  const normalized = typeof result === "string" ? maybeParseJson(result) : result;
  const objectResult = asObject(normalized);
  const stdout = firstText(objectResult?.stdout, objectResult?.output, objectResult?.result);
  const stderr = firstText(objectResult?.stderr, objectResult?.error);
  const exitCode =
    typeof objectResult?.exit_code === "number"
      ? objectResult.exit_code
      : typeof objectResult?.exitCode === "number"
        ? objectResult.exitCode
        : undefined;

  const stdoutLanguage = detectLanguageFromCommand(command) ?? inferTextLanguage(stdout);

  return (
    <ToolFrame
      status={status}
      icon={TerminalIcon}
      label="bash"
      title={title}
      meta={typeof exitCode === "number" ? `exit ${exitCode}` : undefined}
    >
      {command && (
        <Section title="command">
          <CodePanel text={`$ ${command}`} maxLines={10} language="bash" />
        </Section>
      )}
      {stdout && (
        <Section title="stdout">
          <CodePanel text={stdout} maxLines={28} language={stdoutLanguage} />
        </Section>
      )}
      {stderr && (
        <Section title="stderr">
          <CodePanel text={stderr} maxLines={16} language="bash" error />
        </Section>
      )}
      {!stdout && !stderr && <GenericResult result={result} />}
    </ToolFrame>
  );
};

const GrepToolImpl: ToolCallMessagePartComponent = ({ argsText, result, status }) => {
  const args = safeParseArgs(argsText);
  const pattern = firstText(args?.pattern);
  const path = firstText(args?.path);

  return (
    <ToolFrame
      status={status}
      icon={SearchIcon}
      label="grep"
      title={pattern ? `/${pattern}/` : "search"}
      meta={path ? path.split("/").pop() ?? path : undefined}
    >
      {(pattern || path) && (
        <Section title="scope">
          <div className="text-muted-foreground/90 text-[11px]">
            {pattern && <span className="font-mono">/{pattern}/</span>}
            {path && <span className="ml-2 font-mono">{path}</span>}
          </div>
        </Section>
      )}
      <GenericResult result={result} />
    </ToolFrame>
  );
};

const GlobToolImpl: ToolCallMessagePartComponent = ({ argsText, result, status }) => {
  const args = safeParseArgs(argsText);
  const pattern = firstText(args?.pattern);

  return (
    <ToolFrame status={status} icon={FolderIcon} label="glob" title={pattern || "files"}>
      <GenericResult result={result} />
    </ToolFrame>
  );
};

const WebSearchToolImpl: ToolCallMessagePartComponent = ({ argsText, result, status }) => {
  const args = safeParseArgs(argsText);
  const query = firstText(args?.query);

  return (
    <ToolFrame status={status} icon={SearchIcon} label="web search" title={query || "search"}>
      <GenericResult result={result} />
    </ToolFrame>
  );
};

const WebFetchToolImpl: ToolCallMessagePartComponent = ({ argsText, result, status }) => {
  const args = safeParseArgs(argsText);
  const url = firstText(args?.url);
  let displayUrl = url;

  try {
    const parsed = new URL(url);
    displayUrl = `${parsed.hostname}${parsed.pathname !== "/" ? parsed.pathname : ""}`;
  } catch {
    // Keep raw URL.
  }

  return (
    <ToolFrame status={status} icon={GlobeIcon} label="fetch" title={displayUrl || "url"}>
      {url && (
        <Section title="url">
          <PathLine path={url} />
        </Section>
      )}
      <GenericResult result={result} languageHint="xml" />
    </ToolFrame>
  );
};

// ---------------------------------------------------------------------------
// Sub-agent activity rendering (used by TaskTool)
// ---------------------------------------------------------------------------

/** Mirrors the SubAgentItem type in agent-sdk-adapter.ts (structural match). */
type SubAgentItem =
  | { type: "thinking"; text: string }
  | { type: "text"; text: string }
  | { type: "tool"; toolCallId: string; toolName: string; args: Record<string, unknown>; argsText: string; result?: string; isError?: boolean };

type TaskArtifact = { subAgent: SubAgentItem[] };

function isTaskArtifact(v: unknown): v is TaskArtifact {
  return (
    typeof v === "object" &&
    v !== null &&
    "subAgent" in v &&
    Array.isArray((v as TaskArtifact).subAgent)
  );
}

/**
 * Renders a single sub-agent tool call using the appropriate specialized
 * renderer (same ones used for top-level tool calls). Constructs the props
 * needed by each renderer from the stored SubAgentItem data.
 */
const SubAgentToolItem: FC<{ item: Extract<SubAgentItem, { type: "tool" }> }> = ({ item }) => {
  const status: ToolCallMessagePartStatus =
    item.result !== undefined ? { type: "complete" } : { type: "running" };

  // Build the minimal props each tool renderer expects.
  // addResult / resume are no-ops — sub-agent tools are read-only in the display.
  const props = {
    type: "tool-call" as const,
    toolCallId: item.toolCallId,
    toolName: item.toolName,
    args: item.args as Record<string, never>,
    argsText: item.argsText,
    result: item.result,
    isError: item.isError,
    status,
    addResult: () => {},
    resume: () => {},
  };

  switch (item.toolName) {
    case "Read": return <ReadToolImpl {...props} />;
    case "Edit": return <EditToolImpl {...props} />;
    case "Write": return <WriteToolImpl {...props} />;
    case "Bash": return <BashToolImpl {...props} />;
    case "Grep": return <GrepToolImpl {...props} />;
    case "Glob": return <GlobToolImpl {...props} />;
    case "WebSearch": return <WebSearchToolImpl {...props} />;
    case "WebFetch": return <WebFetchToolImpl {...props} />;
    default:
      return (
        <ToolFrame status={status} icon={BotIcon} label="tool" title={item.toolName}>
          {item.result !== undefined && <GenericResult result={item.result} />}
        </ToolFrame>
      );
  }
};

const SubAgentActivityView: FC<{ items: SubAgentItem[] }> = ({ items }) => {
  return (
    <div className="divide-y divide-border/30">
      {items.map((item, i) => {
        if (item.type === "thinking") {
          return (
            <details key={i} className="px-2 py-1.5">
              <summary className="cursor-pointer select-none text-[10px] text-muted-foreground hover:text-foreground">
                Thinking...
              </summary>
              <div className="mt-1 whitespace-pre-wrap text-[11px] text-muted-foreground/80">
                {item.text}
              </div>
            </details>
          );
        }
        if (item.type === "text") {
          return (
            <div key={i} className="px-2 py-1.5 text-sm">
              {item.text}
            </div>
          );
        }
        if (item.type === "tool") {
          return <SubAgentToolItem key={item.toolCallId} item={item} />;
        }
        return null;
      })}
    </div>
  );
};

// ---------------------------------------------------------------------------
// TaskTool
// ---------------------------------------------------------------------------

const TaskToolImpl: ToolCallMessagePartComponent = ({ toolName, argsText, result, status, artifact }) => {
  const args = safeParseArgs(argsText);
  const description = firstText(args?.description);
  const subagentType = firstText(args?.subagent_type);
  const prompt = firstText(args?.prompt);
  const subAgent = isTaskArtifact(artifact) ? artifact.subAgent : null;

  return (
    <ToolFrame
      status={status}
      icon={BotIcon}
      label="task"
      title={description || toolName}
      meta={subagentType || undefined}
    >
      {subagentType && (
        <Section title="agent">
          <span className="text-muted-foreground/90 text-[11px]">{subagentType}</span>
        </Section>
      )}
      {prompt && (
        <Section title="prompt">
          <CodePanel text={prompt} maxLines={8} language="markdown" />
        </Section>
      )}
      {subAgent && subAgent.length > 0 && (
        <Section title="activity">
          <SubAgentActivityView items={subAgent} />
        </Section>
      )}
      <GenericResult result={result} />
    </ToolFrame>
  );
};

export const ReadTool = memo(ReadToolImpl) as ToolCallMessagePartComponent;
export const EditTool = memo(EditToolImpl) as ToolCallMessagePartComponent;
export const WriteTool = memo(WriteToolImpl) as ToolCallMessagePartComponent;
export const BashTool = memo(BashToolImpl) as ToolCallMessagePartComponent;
export const GrepTool = memo(GrepToolImpl) as ToolCallMessagePartComponent;
export const GlobTool = memo(GlobToolImpl) as ToolCallMessagePartComponent;
export const WebSearchTool = memo(WebSearchToolImpl) as ToolCallMessagePartComponent;
export const WebFetchTool = memo(WebFetchToolImpl) as ToolCallMessagePartComponent;
export const TaskTool = memo(TaskToolImpl) as ToolCallMessagePartComponent;
