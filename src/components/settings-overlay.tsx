import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import {
  ArrowLeftIcon,
  XIcon,
  ServerIcon,
  SparklesIcon,
  ShieldCheckIcon,
  TerminalIcon,
  GlobeIcon,
  FolderIcon,
  MessageSquareIcon,
  ChevronDownIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  readClaudeConfig,
  type ResolvedConfig,
  type McpServerConfig,
  type SkillConfig,
  type CommandConfig,
  type ConfigScope,
} from "@/lib/claude-config-reader";
import { db, type ConfigOverrideRow } from "@/lib/db";
import type { AdapterType } from "@/components/RuntimeProvider";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ScopeSelection =
  | { type: "global" }
  | { type: "workspace"; id: string; name: string; cwd: string }
  | { type: "thread"; id: string; title: string };

type TabSection = "mcp_servers" | "skills" | "permissions" | "commands";

interface SettingsOverlayProps {
  open: boolean;
  onClose: () => void;
  workspaces: Array<{ id: string; name: string; cwd: string }>;
  currentThread?: { id: string; title: string } | null;
}

// ---------------------------------------------------------------------------
// Toggle switch
// ---------------------------------------------------------------------------

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (val: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-120 ease-in-out",
        checked ? "bg-primary" : "bg-muted",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block size-4 rounded-full bg-foreground shadow-sm transition-transform duration-120 ease-in-out",
          checked ? "translate-x-4" : "translate-x-0",
        )}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Scope dropdown
// ---------------------------------------------------------------------------

function ScopeChip({
  scope,
  workspaces,
  currentThread,
  onSelect,
}: {
  scope: ScopeSelection;
  workspaces: Array<{ id: string; name: string; cwd: string }>;
  currentThread?: { id: string; title: string } | null;
  onSelect: (scope: ScopeSelection) => void;
}) {
  const [popoverOpen, setPopoverOpen] = useState(false);

  const scopeIcon =
    scope.type === "global" ? GlobeIcon :
    scope.type === "workspace" ? FolderIcon :
    MessageSquareIcon;
  const ScopeIcon = scopeIcon;

  const scopeLabel =
    scope.type === "global" ? "Global" :
    scope.type === "workspace" ? scope.name :
    scope.title;

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="aui-composer-chip aui-composer-chip-interactive"
        >
          <ScopeIcon className="size-3.5" />
          <span className="truncate max-w-[140px]">{scopeLabel}</span>
          <ChevronDownIcon className="size-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="aui-model-popover w-56 p-1.5"
      >
        {/* Global */}
        <button
          type="button"
          onClick={() => { onSelect({ type: "global" }); setPopoverOpen(false); }}
          className={cn(
            "aui-model-option",
            scope.type === "global" && "aui-model-option-active",
          )}
        >
          <GlobeIcon className="size-3.5" />
          Global
        </button>

        {/* Workspaces */}
        {workspaces.length > 0 && (
          <>
            <div className="mt-2 mb-1 px-2 text-[0.6rem] font-semibold uppercase tracking-[0.11em] text-muted-foreground">
              Workspaces
            </div>
            {workspaces.map((ws) => (
              <button
                key={ws.id}
                type="button"
                onClick={() => {
                  onSelect({ type: "workspace", id: ws.id, name: ws.name, cwd: ws.cwd });
                  setPopoverOpen(false);
                }}
                className={cn(
                  "aui-model-option",
                  scope.type === "workspace" && scope.id === ws.id && "aui-model-option-active",
                )}
              >
                <FolderIcon className="size-3.5" />
                <span className="truncate">{ws.name}</span>
              </button>
            ))}
          </>
        )}

        {/* Thread */}
        {currentThread && (
          <>
            <div className="mt-2 mb-1 px-2 text-[0.6rem] font-semibold uppercase tracking-[0.11em] text-muted-foreground">
              Thread
            </div>
            <button
              type="button"
              onClick={() => {
                onSelect({ type: "thread", id: currentThread.id, title: currentThread.title });
                setPopoverOpen(false);
              }}
              className={cn(
                "aui-model-option",
                scope.type === "thread" && "aui-model-option-active",
              )}
            >
              <MessageSquareIcon className="size-3.5" />
              <span className="truncate">{currentThread.title}</span>
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Tab bar
// ---------------------------------------------------------------------------

const TAB_DEFS: Array<{
  key: TabSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { key: "mcp_servers", label: "MCP Servers", icon: ServerIcon },
  { key: "skills", label: "Skills", icon: SparklesIcon },
  { key: "permissions", label: "Permissions", icon: ShieldCheckIcon },
  { key: "commands", label: "Commands", icon: TerminalIcon },
];

function TabBar({
  activeTab,
  onTabChange,
  counts,
}: {
  activeTab: TabSection;
  onTabChange: (tab: TabSection) => void;
  counts: Record<TabSection, number>;
}) {
  return (
    <div className="flex items-center gap-1 border-b border-border px-4">
      {TAB_DEFS.map(({ key, label, icon: Icon }) => {
        const count = counts[key];
        const isActive = activeTab === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onTabChange(key)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 font-mono text-[0.72rem] transition-colors duration-120",
              isActive
                ? "border-b-2 border-b-primary text-foreground"
                : "border-b-2 border-b-transparent text-muted-foreground hover:text-foreground",
              count === 0 && "opacity-40",
            )}
          >
            <Icon className="size-3.5" />
            {label}
            <span className="text-muted-foreground">({count})</span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card components
// ---------------------------------------------------------------------------

function McpServerCard({
  server,
  isEnabled,
  onToggle,
  readOnly,
}: {
  server: McpServerConfig;
  isEnabled: boolean;
  onToggle?: (enabled: boolean) => void;
  readOnly?: boolean;
}) {
  const detail = server.command
    ? [server.command, ...(server.args ?? [])].join(" ")
    : server.url ?? "";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "rounded-lg border border-border bg-card p-2.5 transition-[border-color,background] duration-120 ease-in-out hover:border-border/80 hover:bg-[color-mix(in_srgb,var(--card)_90%,var(--foreground))]",
            !isEnabled && "opacity-50",
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-mono text-sm font-medium text-foreground">
              {server.name}
            </span>
            <Toggle
              checked={isEnabled}
              onChange={(v) => onToggle?.(v)}
              disabled={readOnly}
            />
          </div>
          <div className="mt-1 font-mono text-[0.68rem] text-muted-foreground">
            {server.source}
            <span className="mx-1 opacity-40">&middot;</span>
            {server.type}
          </div>
        </div>
      </TooltipTrigger>
      {detail && (
        <TooltipContent side="bottom" className="max-w-xs font-mono text-xs">
          {detail}
        </TooltipContent>
      )}
    </Tooltip>
  );
}

function SkillCard({
  skill,
  isEnabled,
  onToggle,
  readOnly,
}: {
  skill: SkillConfig;
  isEnabled: boolean;
  onToggle?: (enabled: boolean) => void;
  readOnly?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "rounded-lg border border-border bg-card p-2.5 transition-[border-color,background] duration-120 ease-in-out hover:border-border/80 hover:bg-[color-mix(in_srgb,var(--card)_90%,var(--foreground))]",
            !isEnabled && "opacity-50",
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-mono text-sm font-medium text-foreground">
              {skill.name}
            </span>
            <Toggle
              checked={isEnabled}
              onChange={(v) => onToggle?.(v)}
              disabled={readOnly}
            />
          </div>
          <div className="mt-1 font-mono text-[0.68rem] text-muted-foreground">
            {skill.source}
          </div>
        </div>
      </TooltipTrigger>
      {skill.description && (
        <TooltipContent side="bottom" className="max-w-xs text-xs">
          {skill.description}
        </TooltipContent>
      )}
    </Tooltip>
  );
}

function PermissionCard({
  permission,
  isEnabled,
  onToggle,
  readOnly,
}: {
  permission: string;
  isEnabled: boolean;
  onToggle?: (enabled: boolean) => void;
  readOnly?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card p-2.5 transition-[border-color,background] duration-120 ease-in-out hover:border-border/80 hover:bg-[color-mix(in_srgb,var(--card)_90%,var(--foreground))]",
        !isEnabled && "opacity-50",
      )}
    >
      <div className="font-mono text-sm font-medium text-foreground">
        {permission}
      </div>
      <div className="mt-1.5 flex justify-end">
        <Toggle
          checked={isEnabled}
          onChange={(v) => onToggle?.(v)}
          disabled={readOnly}
        />
      </div>
    </div>
  );
}

function CommandCard({ command }: { command: CommandConfig }) {
  return (
    <div className="rounded-lg border border-border bg-card p-2.5">
      <div className="font-mono text-sm font-medium text-foreground">
        /{command.name}
      </div>
      <div className="mt-1 font-mono text-[0.68rem] text-muted-foreground">
        {command.source}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SettingsOverlay({
  open,
  onClose,
  workspaces,
  currentThread,
}: SettingsOverlayProps) {
  const [scope, setScope] = useState<ScopeSelection>({ type: "global" });
  const [config, setConfig] = useState<ResolvedConfig | null>(null);
  const [overrides, setOverrides] = useState<ConfigOverrideRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<TabSection>("mcp_servers");
  const [adapterType, setAdapterType] = useState<AdapterType>("shell");
  const [adapterChanged, setAdapterChanged] = useState(false);

  // Load adapter type when overlay opens
  useEffect(() => {
    if (!open) return;
    db.globalSettings.get("adapter_type").then((v) => {
      setAdapterType(v === "agent-sdk" ? "agent-sdk" : "shell");
    }).catch(console.error);
  }, [open]);

  const handleAdapterChange = async (next: AdapterType) => {
    setAdapterType(next);
    await db.globalSettings.set("adapter_type", next);
    setAdapterChanged(true);
  };

  // Load config when overlay opens
  useEffect(() => {
    if (!open) return;
    setLoading(true);

    const cwds = workspaces.map((w) => w.cwd);
    readClaudeConfig(cwds)
      .then(setConfig)
      .catch((err) => console.error("[settings] config read error:", err))
      .finally(() => setLoading(false));
  }, [open, workspaces]);

  // Load overrides for current scope
  useEffect(() => {
    if (!open) return;
    if (scope.type === "global") {
      setOverrides([]);
      return;
    }
    const scopeId = scope.id;
    db.configOverrides
      .list(scope.type, scopeId)
      .then(setOverrides)
      .catch((err) => console.error("[settings] overrides load error:", err));
  }, [open, scope]);

  // Check if an item is enabled (considering overrides)
  const isEnabled = useMemo(() => {
    const overrideMap = new Map(
      overrides.map((o) => [`${o.item_type}:${o.item_name}`, o.enabled === 1]),
    );
    return (itemType: ConfigOverrideRow["item_type"], itemName: string): boolean => {
      const key = `${itemType}:${itemName}`;
      return overrideMap.get(key) ?? true; // default enabled
    };
  }, [overrides]);

  // Toggle handler
  const handleToggle = async (
    itemType: ConfigOverrideRow["item_type"],
    itemName: string,
    enabled: boolean,
  ) => {
    if (scope.type === "global") return; // global is read-only

    const scopeId = scope.id;
    await db.configOverrides.upsert(scope.type, scopeId, itemType, itemName, enabled);

    // Refresh overrides
    const updated = await db.configOverrides.list(scope.type, scopeId);
    setOverrides(updated);
  };

  // Resolve current scope's config
  const scopeConfig = useMemo((): ConfigScope | null => {
    if (!config) return null;
    if (scope.type === "global") return config.global;
    if (scope.type === "workspace") {
      const project = config.projects.get(scope.cwd);
      return {
        mcpServers: [
          ...config.global.mcpServers,
          ...(project?.mcpServers ?? []),
        ],
        skills: [...config.global.skills, ...(project?.skills ?? [])],
        permissions: [
          ...config.global.permissions,
          ...(project?.permissions ?? []),
        ],
        commands: [...config.global.commands, ...(project?.commands ?? [])],
      };
    }
    // Thread scope — show everything (global + workspace if applicable)
    return {
      mcpServers: config.global.mcpServers,
      skills: config.global.skills,
      permissions: config.global.permissions,
      commands: config.global.commands,
    };
  }, [config, scope]);

  // Tab counts
  const tabCounts = useMemo((): Record<TabSection, number> => ({
    mcp_servers: scopeConfig?.mcpServers.length ?? 0,
    skills: scopeConfig?.skills.length ?? 0,
    permissions: scopeConfig?.permissions.length ?? 0,
    commands: scopeConfig?.commands.length ?? 0,
  }), [scopeConfig]);

  if (!open) return null;

  const readOnly = scope.type === "global";

  // Empty state label per tab
  const emptyLabels: Record<TabSection, string> = {
    mcp_servers: "No MCP servers configured at this scope.",
    skills: "No skills configured at this scope.",
    permissions: "No permissions configured at this scope.",
    commands: "No commands configured at this scope.",
  };

  return (
    <TooltipProvider>
      <div className="fixed inset-0 z-50 flex flex-col bg-background animate-in fade-in duration-180">
        {/* Header */}
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onClose}
              aria-label="Close settings"
            >
              <ArrowLeftIcon className="size-4" />
            </Button>
            <span className="text-[0.69rem] font-semibold uppercase tracking-[0.11em] text-muted-foreground">
              Settings
            </span>
            <ScopeChip
              scope={scope}
              workspaces={workspaces}
              currentThread={currentThread ?? undefined}
              onSelect={setScope}
            />
            {readOnly && (
              <span className="font-mono text-[0.64rem] text-muted-foreground/60">
                Read-only
              </span>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onClose}
            aria-label="Close"
          >
            <XIcon className="size-4" />
          </Button>
        </div>

        {/* Engine selector */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-2">
          <span className="text-[0.69rem] font-semibold uppercase tracking-[0.11em] text-muted-foreground">
            Engine
          </span>
          <div className="flex items-center gap-1.5">
            {(["shell", "agent-sdk"] as AdapterType[]).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => void handleAdapterChange(opt)}
                className={cn(
                  "rounded px-2.5 py-1 font-mono text-[0.72rem] transition-colors duration-120",
                  adapterType === opt
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {opt === "shell" ? "Shell (Claude CLI)" : "Agent SDK"}
              </button>
            ))}
          </div>
          {adapterChanged && (
            <span className="font-mono text-[0.64rem] text-muted-foreground/70">
              Restart to apply
            </span>
          )}
        </div>

        {/* Tab bar */}
        <TabBar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          counts={tabCounts}
        />

        {/* Main panel — card grid */}
        <main className="settings-overlay-main flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="text-sm text-muted-foreground">Loading configuration...</div>
          ) : !scopeConfig ? (
            <div className="text-sm text-muted-foreground">No configuration found.</div>
          ) : tabCounts[activeTab] === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {emptyLabels[activeTab]}
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
              {activeTab === "mcp_servers" &&
                scopeConfig.mcpServers.map((server) => (
                  <McpServerCard
                    key={`${server.source}:${server.name}`}
                    server={server}
                    isEnabled={isEnabled("mcp_server", server.name)}
                    onToggle={(v) =>
                      void handleToggle("mcp_server", server.name, v)
                    }
                    readOnly={readOnly}
                  />
                ))}

              {activeTab === "skills" &&
                scopeConfig.skills.map((skill) => (
                  <SkillCard
                    key={`${skill.source}:${skill.name}`}
                    skill={skill}
                    isEnabled={isEnabled("skill", skill.name)}
                    onToggle={(v) =>
                      void handleToggle("skill", skill.name, v)
                    }
                    readOnly={readOnly}
                  />
                ))}

              {activeTab === "permissions" &&
                scopeConfig.permissions.map((perm) => (
                  <PermissionCard
                    key={perm}
                    permission={perm}
                    isEnabled={isEnabled("permission", perm)}
                    onToggle={(v) =>
                      void handleToggle("permission", perm, v)
                    }
                    readOnly={readOnly}
                  />
                ))}

              {activeTab === "commands" &&
                scopeConfig.commands.map((cmd) => (
                  <CommandCard
                    key={`${cmd.source}:${cmd.name}`}
                    command={cmd}
                  />
                ))}
            </div>
          )}
        </main>
      </div>
    </TooltipProvider>
  );
}
