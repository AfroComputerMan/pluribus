import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  clearClaudeDevSnapshot,
  getClaudeDevSnapshot,
  subscribeClaudeDevSnapshot,
  type ClaudeDevEvent,
  type ClaudeDevEventCategory,
} from "@/lib/claude-adapter";
import { cn } from "@/lib/utils";
import {
  ActivityIcon,
  BracesIcon,
  BugIcon,
  CommandIcon,
  DatabaseIcon,
  HammerIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useMemo, useState, useSyncExternalStore } from "react";

type ViewMode = "organized" | "raw";

const CATEGORY_ORDER: ClaudeDevEventCategory[] = [
  "hooks",
  "mcp",
  "commands",
  "skills",
  "usage",
  "messages",
  "other",
];

const CATEGORY_LABELS: Record<ClaudeDevEventCategory, string> = {
  hooks: "Hooks",
  mcp: "MCP",
  commands: "Commands",
  skills: "Skills",
  usage: "Usage",
  messages: "Messages",
  other: "Other",
};

function formatNumber(value?: number): string {
  if (typeof value !== "number") return "0";
  return value.toLocaleString();
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatTs(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function summarizeEvent(event: ClaudeDevEvent): string {
  const parsed = event.parsed as unknown as Record<string, unknown>;
  if (parsed.type === "system" && parsed.subtype === "hook_started") {
    return String(parsed.hook_name ?? "hook_started");
  }
  if (parsed.type === "system" && parsed.subtype === "hook_response") {
    return String(parsed.hook_name ?? "hook_response");
  }
  if (parsed.type === "system" && parsed.subtype === "init") {
    const toolCount = Array.isArray(parsed.tools) ? parsed.tools.length : 0;
    const skillCount = Array.isArray(parsed.skills) ? parsed.skills.length : 0;
    const mcpCount = Array.isArray(parsed.mcp_servers) ? parsed.mcp_servers.length : 0;
    return `init: tools=${toolCount}, skills=${skillCount}, mcp_servers=${mcpCount}`;
  }
  if (parsed.type === "assistant") {
    return `assistant event (${String(parsed.session_id ?? "no-session")})`;
  }
  if (parsed.type === "result") {
    const usage = (parsed.usage ?? {}) as Record<string, unknown>;
    return `result: in=${String(usage.input_tokens ?? 0)}, out=${String(usage.output_tokens ?? 0)}`;
  }
  return `${String(parsed.type ?? "unknown")}${parsed.subtype ? `:${String(parsed.subtype)}` : ""}`;
}

export function DevPanel() {
  const snapshot = useSyncExternalStore(subscribeClaudeDevSnapshot, getClaudeDevSnapshot);
  const [open, setOpen] = useState(true);
  const [mode, setMode] = useState<ViewMode>("organized");

  const grouped = useMemo(() => {
    const map = new Map<ClaudeDevEventCategory, ClaudeDevEvent[]>();
    for (const category of CATEGORY_ORDER) {
      map.set(category, []);
    }
    for (const event of snapshot.events) {
      map.get(event.category)?.push(event);
    }
    return map;
  }, [snapshot.events]);

  const latestUsage = snapshot.latestUsageEvent?.parsed;
  const usage = latestUsage?.usage;
  const modelUsageEntry = latestUsage?.modelUsage
    ? Object.entries(latestUsage.modelUsage)[0]
    : null;
  const contextWindow = modelUsageEntry?.[1]?.contextWindow ?? 0;
  const inputTokens = usage?.input_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? 0;
  const cacheCreation = usage?.cache_creation_input_tokens ?? 0;
  const cacheRead = usage?.cache_read_input_tokens ?? 0;
  const contextTotal = inputTokens + cacheCreation + cacheRead;
  const contextPct = contextWindow > 0 ? contextTotal / contextWindow : 0;

  const latestInit = snapshot.latestInitEvent?.parsed as
    | {
        tools?: string[];
        mcp_servers?: Array<{ name?: string; status?: string }>;
        slash_commands?: string[];
        skills?: string[];
      }
    | undefined;
  const tools = latestInit?.tools ?? [];
  const mcpTools = tools.filter((t) => t.startsWith("mcp__"));
  const builtInTools = tools.filter((t) => !t.startsWith("mcp__"));
  const mcpServers = latestInit?.mcp_servers ?? [];
  const slashCommands = latestInit?.slash_commands ?? [];
  const skills = latestInit?.skills ?? [];

  if (!open) {
    return (
      <div className="fixed top-3 right-3 z-50">
        <Button
          variant="secondary"
          size="sm"
          className="gap-2"
          onClick={() => setOpen(true)}
        >
          <BugIcon className="size-4" />
          Dev Panel
        </Button>
      </div>
    );
  }

  return (
    <aside className="fixed inset-y-0 right-0 z-50 flex w-[460px] max-w-[95vw] flex-col border-l bg-card/95 backdrop-blur">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <BugIcon className="size-4" />
          Claude Stream Dev Panel
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="xs"
            onClick={() => clearClaudeDevSnapshot()}
            className="gap-1"
          >
            <Trash2Icon className="size-3" />
            Clear
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={() => setOpen(false)}>
            <XIcon className="size-3" />
          </Button>
        </div>
      </div>

      <div className="flex gap-2 border-b px-3 py-2">
        <Button
          variant={mode === "organized" ? "default" : "outline"}
          size="xs"
          onClick={() => setMode("organized")}
        >
          Organized
        </Button>
        <Button
          variant={mode === "raw" ? "default" : "outline"}
          size="xs"
          onClick={() => setMode("raw")}
        >
          Raw JSON
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {mode === "organized" ? (
          <div className="space-y-4">
            <Card className="gap-3 py-4">
              <CardHeader className="px-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                <ActivityIcon className="size-4" />
                Usage & Context
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 px-3">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Metric label="Session" value={snapshot.latestSessionId ?? "n/a"} mono />
                <Metric
                  label="Total Cost USD"
                  value={
                    typeof latestUsage?.total_cost_usd === "number"
                      ? latestUsage.total_cost_usd.toFixed(6)
                      : "n/a"
                  }
                />
                <Metric label="Input Tokens" value={formatNumber(inputTokens)} />
                <Metric label="Output Tokens" value={formatNumber(outputTokens)} />
                <Metric label="Cache Read" value={formatNumber(cacheRead)} />
                <Metric label="Cache Create" value={formatNumber(cacheCreation)} />
                <Metric label="Context Used" value={formatNumber(contextTotal)} />
                <Metric
                  label="Context Window"
                  value={contextWindow ? formatNumber(contextWindow) : "n/a"}
                />
              </div>
              <div className="mt-3 space-y-1 text-xs">
                <div className="h-2 w-full overflow-hidden rounded bg-muted">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{
                      width: `${Math.min(100, Math.max(0, contextPct * 100))}%`,
                    }}
                  />
                </div>
                <div className="text-muted-foreground">
                  Context pressure: {contextWindow ? formatPercent(contextPct) : "n/a"}
                </div>
                <div className="text-muted-foreground">
                  Composition: input{" "}
                  {contextTotal ? formatPercent(inputTokens / contextTotal) : "0.0%"} / cache-read{" "}
                  {contextTotal ? formatPercent(cacheRead / contextTotal) : "0.0%"} / cache-create{" "}
                  {contextTotal ? formatPercent(cacheCreation / contextTotal) : "0.0%"}
                </div>
              </div>
              </CardContent>
            </Card>

            <Card className="gap-3 py-4">
              <CardHeader className="px-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                <DatabaseIcon className="size-4" />
                Init Capabilities
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 px-3">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Metric label="Tools" value={formatNumber(tools.length)} />
                <Metric label="MCP Tools" value={formatNumber(mcpTools.length)} />
                <Metric label="MCP Servers" value={formatNumber(mcpServers.length)} />
                <Metric label="Skills" value={formatNumber(skills.length)} />
                <Metric label="Slash Commands" value={formatNumber(slashCommands.length)} />
                <Metric label="Built-in Tools" value={formatNumber(builtInTools.length)} />
              </div>
              <div className="mt-3 space-y-2 text-xs">
                <div>
                  <div className="mb-1 font-medium">MCP Servers</div>
                  <div className="space-y-1">
                    {mcpServers.slice(0, 8).map((server, index) => (
                      <div key={`${server.name ?? "server"}-${index}`} className="flex justify-between gap-2 rounded border px-2 py-1">
                        <span className="truncate">{server.name ?? "unknown"}</span>
                        <span className="text-muted-foreground">{server.status ?? "unknown"}</span>
                      </div>
                    ))}
                    {mcpServers.length === 0 && <div className="text-muted-foreground">No init event captured yet.</div>}
                  </div>
                </div>
                <FacetList title="Skills" icon={<HammerIcon className="size-3" />} values={skills} />
                <FacetList title="Slash Commands" icon={<CommandIcon className="size-3" />} values={slashCommands} />
              </div>
              </CardContent>
            </Card>

            <Card className="gap-3 py-4">
              <CardHeader className="px-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                <BracesIcon className="size-4" />
                Event Categories
                </CardTitle>
              </CardHeader>
              <CardContent className="px-3">
              <div className="space-y-2">
                {CATEGORY_ORDER.map((category) => {
                  const events = grouped.get(category) ?? [];
                  const latest = events[events.length - 1];
                  return (
                    <div key={category} className="rounded border px-2 py-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{CATEGORY_LABELS[category]}</span>
                        <Badge variant="secondary">{events.length}</Badge>
                      </div>
                      {latest && (
                        <div className="mt-1 text-muted-foreground">
                          {formatTs(latest.at)} • {summarizeEvent(latest)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="space-y-2">
            {[...snapshot.events].reverse().map((event) => (
              <div key={event.id} className="rounded border p-2">
                <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>{formatTs(event.at)}</span>
                  <Badge variant="outline">{CATEGORY_LABELS[event.category]}</Badge>
                </div>
                <pre className="max-h-72 overflow-auto rounded bg-muted/50 p-2 font-mono text-[11px] leading-4">
                  {JSON.stringify(parseMaybeJson(event.raw), null, 2)}
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function Metric({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded border bg-muted/30 px-2 py-1">
      <div className="text-muted-foreground">{label}</div>
      <div className={cn("truncate font-medium", mono && "font-mono text-[11px]")}>{value}</div>
    </div>
  );
}

function FacetList({
  title,
  icon,
  values,
}: {
  title: string;
  icon: ReactNode;
  values: string[];
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1 font-medium">
        {icon}
        {title}
      </div>
      {values.length === 0 ? (
        <div className="text-muted-foreground">None</div>
      ) : (
        <div className="flex flex-wrap gap-1">
          {values.slice(0, 24).map((value) => (
            <Badge key={value} variant="outline" className="max-w-full truncate">
              {value}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
