import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import {
  ReadTool,
  EditTool,
  WriteTool,
  BashTool,
  GrepTool,
  GlobTool,
  WebSearchTool,
  WebFetchTool,
  TaskTool,
} from "@/components/assistant-ui/claude-tool-display";
import { CodexToolDisplay } from "@/components/assistant-ui/codex-tool-display";
import { PiToolDisplay } from "@/components/assistant-ui/pi-tool-display";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  getPermissionRequests,
  respondToPermissionRequest,
  subscribePermissionRequests,
} from "@/lib/dev-events";
import { db, type WorkspaceRow } from "@/lib/db";
import {
  CLAUDE_MODELS,
  CODEX_MODELS,
  PI_MODELS,
  EFFORT_LEVELS,
  CODEX_EFFORT_LEVELS,
  resolveModel,
  resolveEffort,
  getModelById,
  isCodexModel,
  type EffortLevel,
} from "@/lib/models";
import {
  createWorkspaceBranch,
  getWorkspaceRepoMeta,
  listWorkspaceBranches,
  switchWorkspaceBranch,
  type WorkspaceRepoMeta,
} from "@/lib/workspace-repo-metadata";
import { getPendingThreadOptions, setPendingThreadOptions } from "@/lib/sqlite-thread-list-adapter";
import {
  ActionBarMorePrimitive,
  ActionBarPrimitive,
  AuiIf,
  ChainOfThoughtPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  type ReasoningMessagePartProps,
  type ToolCallMessagePartComponent,
} from "@assistant-ui/react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BotIcon,
  BrainCircuitIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  DownloadIcon,
  FolderOpenIcon,
  FolderRootIcon,
  GitBranchIcon,
  GithubIcon,
  LoaderCircleIcon,
  MoreHorizontalIcon,
  SquareIcon,
} from "lucide-react";
import { type FC, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

/** Hook to check whether the current thread has a workspace assigned. */
function useThreadWorkspace() {
  // Use the internal thread list item id (always available, even before initialize).
  const threadId = useAuiState(({ threadListItem }) => threadListItem.id ?? null);
  const remoteId = useAuiState(({ threadListItem }) => threadListItem.remoteId ?? null);
  const isEmpty = useAuiState(({ thread }) => thread.isEmpty);

  // null = still loading, true/false = resolved
  const [hasWorkspace, setHasWorkspace] = useState<boolean | null>(null);

  useEffect(() => {
    if (!remoteId) {
      // Thread hasn't been initialized yet (no first message sent). Check if a
      // workspace was pre-assigned via the workspace "+" button so we can skip
      // the workspace picker and show the composer immediately.
      const pending = threadId ? getPendingThreadOptions(threadId) : undefined;
      setHasWorkspace(Boolean(pending?.workspaceId));
      return;
    }

    let cancelled = false;
    db.threads
      .get(remoteId)
      .then((row) => {
        if (!cancelled) setHasWorkspace(Boolean(row?.workspace_id));
      })
      .catch(() => {
        if (!cancelled) setHasWorkspace(false);
      });
    return () => {
      cancelled = true;
    };
  }, [remoteId, threadId]);

  return { threadId, remoteId, isEmpty, hasWorkspace, setHasWorkspace };
}

export const Thread: FC = () => {
  const { threadId, isEmpty, hasWorkspace, setHasWorkspace } = useThreadWorkspace();
  const needsWorkspace = isEmpty && hasWorkspace === false;

  return (
    <ThreadPrimitive.Root
      className="aui-root aui-thread-root @container flex h-full flex-col bg-background"
      style={{
        ["--thread-max-width" as string]: "44rem",
      }}
    >
      <ThreadPrimitive.Viewport
        turnAnchor="top"
        className="aui-thread-viewport relative flex flex-1 flex-col overflow-x-auto overflow-y-scroll scroll-smooth px-4 pt-4"
      >
        {needsWorkspace ? (
          <WorkspacePicker
            threadId={threadId}
            onWorkspaceSelected={() => setHasWorkspace(true)}
          />
        ) : (
          <AuiIf condition={(s) => s.thread.isEmpty}>
            <ThreadWelcome />
          </AuiIf>
        )}

        <ThreadPrimitive.Messages
          components={{
            UserMessage,
            AssistantMessage,
          }}
        />

        <ThreadPrimitive.ViewportFooter className="aui-thread-viewport-footer sticky bottom-0 mx-auto mt-auto flex w-full max-w-(--thread-max-width) flex-col gap-3 overflow-visible pb-4 md:pb-6">
          <ThreadScrollToBottom />
          <PermissionApprovalBar />
          {needsWorkspace ? (
            <div className="rounded-2xl border border-input bg-muted/50 px-4 py-3 text-center text-muted-foreground text-sm">
              Select a workspace above to start chatting
            </div>
          ) : (
            <Composer />
          )}
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
};

const ThreadScrollToBottom: FC = () => {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <TooltipIconButton
        tooltip="Scroll to bottom"
        variant="outline"
        className="aui-thread-scroll-to-bottom absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible dark:bg-background dark:hover:bg-accent"
      >
        <ArrowDownIcon />
      </TooltipIconButton>
    </ThreadPrimitive.ScrollToBottom>
  );
};

const ThreadWelcome: FC = () => {
  return (
    <div className="aui-thread-welcome-root mx-auto my-auto flex w-full max-w-(--thread-max-width) grow flex-col">
      <div className="aui-thread-welcome-center flex w-full grow flex-col items-center justify-center">
        <div className="aui-thread-welcome-message flex size-full flex-col justify-center px-4">
          <h1 className="aui-thread-welcome-message-inner font-semibold text-2xl">
            What can I help with?
          </h1>
        </div>
      </div>
    </div>
  );
};

const WorkspacePicker: FC<{
  threadId: string | null;
  onWorkspaceSelected: () => void;
}> = ({ threadId, onWorkspaceSelected }) => {
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [repoMetaByWorkspaceId, setRepoMetaByWorkspaceId] = useState<
    Record<string, WorkspaceRepoMeta>
  >({});
  const [workspaceLastUsedAtById, setWorkspaceLastUsedAtById] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [selectionError, setSelectionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([db.workspaces.list(), db.threads.list()])
      .then(([rows, threadRows]) => {
        if (!cancelled) {
          setWorkspaces(rows);
          const nextLastUsedAtById: Record<string, string> = {};
          for (const thread of threadRows) {
            const workspaceId = thread.workspace_id?.trim();
            if (!workspaceId) continue;
            const current = nextLastUsedAtById[workspaceId];
            if (!current || thread.updated_at > current) {
              nextLastUsedAtById[workspaceId] = thread.updated_at;
            }
          }
          setWorkspaceLastUsedAtById(nextLastUsedAtById);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const orderedWorkspaces = useMemo(() => {
    const folderRecentSortThreshold = 8;
    const getDisplayName = (workspace: WorkspaceRow) => {
      const repoMeta = repoMetaByWorkspaceId[workspace.id];
      if (repoMeta?.repoName) return repoMeta.repoName;
      const workspaceNameParts = workspace.name.split(/[\\/]/).filter(Boolean);
      return workspaceNameParts[workspaceNameParts.length - 1] ?? workspace.name;
    };

    const alphabeticalSort = (a: WorkspaceRow, b: WorkspaceRow) =>
      getDisplayName(a).localeCompare(getDisplayName(b), undefined, { sensitivity: "base" });

    const repos = workspaces
      .filter((workspace) => Boolean(repoMetaByWorkspaceId[workspace.id]))
      .sort(alphabeticalSort);

    const folders = workspaces.filter((workspace) => !repoMetaByWorkspaceId[workspace.id]);
    const sortedFolders = [...folders];
    if (sortedFolders.length >= folderRecentSortThreshold) {
      sortedFolders.sort((a, b) => {
        const aLastUsed = workspaceLastUsedAtById[a.id] ?? "";
        const bLastUsed = workspaceLastUsedAtById[b.id] ?? "";
        if (aLastUsed !== bLastUsed) return bLastUsed.localeCompare(aLastUsed);
        return alphabeticalSort(a, b);
      });
    } else {
      sortedFolders.sort(alphabeticalSort);
    }

    return [...repos, ...sortedFolders];
  }, [repoMetaByWorkspaceId, workspaceLastUsedAtById, workspaces]);

  useEffect(() => {
    let cancelled = false;

    const loadRepoMeta = async () => {
      if (!workspaces.length) {
        if (!cancelled) setRepoMetaByWorkspaceId({});
        return;
      }

      const entries = await Promise.all(
        workspaces.map(async (workspace) => {
          const meta = await getWorkspaceRepoMeta(workspace.cwd);
          return [workspace.id, meta] as const;
        }),
      );

      if (cancelled) return;

      const next: Record<string, WorkspaceRepoMeta> = {};
      for (const [workspaceId, meta] of entries) {
        if (meta) next[workspaceId] = meta;
      }
      setRepoMetaByWorkspaceId(next);
    };

    void loadRepoMeta().catch(() => {
      if (!cancelled) setRepoMetaByWorkspaceId({});
    });

    return () => {
      cancelled = true;
    };
  }, [workspaces]);

  const selectWorkspace = useCallback(
    async (workspace: WorkspaceRow) => {
      if (!threadId) return;
      setSelectionError(null);
      try {
        // Always set pending options so initialize() picks them up for new threads.
        setPendingThreadOptions(threadId, {
          workspaceId: workspace.id,
          cwd: workspace.cwd,
          model: localStorage.getItem("pluribus:lastModel"),
          effort: localStorage.getItem("pluribus:lastEffort"),
        });
        // Try updating the DB row (no-op if thread hasn't been initialized yet).
        const existing = await db.threads.get(threadId);
        if (existing) {
          await db.threads.updateWorkspace(threadId, workspace.id, workspace.cwd);
        }
        onWorkspaceSelected();
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : "Failed to select workspace.";
        setSelectionError(message);
      }
    },
    [threadId, onWorkspaceSelected],
  );

  return (
    <div className="aui-thread-welcome-root mx-auto my-auto flex w-full max-w-(--thread-max-width) grow flex-col">
      <div className="aui-thread-welcome-center flex w-full grow flex-col items-center justify-center">
        <div className="flex size-full flex-col justify-center gap-4 px-4">
          <div>
            <h1 className="fade-in slide-in-from-bottom-1 animate-in font-semibold text-2xl duration-200">
              Select a workspace
            </h1>
            <p className="fade-in slide-in-from-bottom-1 animate-in text-muted-foreground text-base delay-75 duration-200">
              Choose a project directory for this chat.
            </p>
            {selectionError ? (
              <p className="mt-2 text-destructive text-sm">{selectionError}</p>
            ) : null}
          </div>

          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <LoaderCircleIcon className="size-4 animate-spin" />
              Loading workspaces...
            </div>
          ) : workspaces.length ? (
            <div className="flex flex-col gap-2">
              {orderedWorkspaces.map((workspace) => {
                const repoMeta = repoMetaByWorkspaceId[workspace.id];
                const workspaceNameParts = workspace.name.split(/[\\/]/).filter(Boolean);
                const displayWorkspaceName = repoMeta?.repoName
                  ?? (workspace.name.includes("/") || workspace.name.includes("\\")
                    ? workspaceNameParts[workspaceNameParts.length - 1] ?? workspace.name
                    : workspace.name);
                const workspacePath = repoMeta?.repoRoot ?? workspace.cwd;

                return (
                  <button
                    key={workspace.id}
                    type="button"
                    className="flex items-center gap-3 rounded-lg border bg-card/60 px-4 py-3 text-left transition-colors hover:bg-muted"
                    onClick={() => void selectWorkspace(workspace)}
                    title={workspacePath}
                  >
                    {repoMeta ? (
                      repoMeta.isGithub ? (
                        <GithubIcon className="size-5 shrink-0 text-foreground" />
                      ) : (
                        <FolderRootIcon className="size-5 shrink-0 text-muted-foreground" />
                      )
                    ) : (
                      <FolderOpenIcon className="size-5 shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0">
                      <p className="truncate font-medium text-sm" title={workspacePath}>
                        {displayWorkspaceName}
                      </p>
                      {repoMeta ? (
                        <p className="truncate text-muted-foreground text-xs">
                          <span className="inline-flex items-center gap-1">
                            <GitBranchIcon className="size-3" />
                            <span className="max-w-[12rem] truncate" title={repoMeta.branch}>
                              {repoMeta.branch}
                            </span>
                          </span>
                        </p>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              No workspaces yet. Create one from the sidebar.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

const Composer: FC = () => {
  return (
    <ComposerPrimitive.Root
      className="aui-composer-root relative flex w-full flex-col"
    >
      <div className="aui-composer-shell flex w-full flex-col rounded-2xl border border-input bg-background px-1 pt-2 outline-none transition-shadow has-[textarea:focus-visible]:border-ring has-[textarea:focus-visible]:ring-2 has-[textarea:focus-visible]:ring-ring/20">
        <ComposerPrimitive.Input
          placeholder="Send a message..."
          className="aui-composer-input mb-1 max-h-32 min-h-14 w-full resize-none bg-transparent px-4 pt-2 pb-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-0"
          rows={1}
          autoFocus
          aria-label="Message input"
        />
        <ComposerAction />
      </div>
    </ComposerPrimitive.Root>
  );
};

const PermissionApprovalBar: FC = () => {
  const activeThreadId = useAuiState(({ threadListItem }) => threadListItem.remoteId ?? null);
  const getSnapshot = useCallback(
    () => getPermissionRequests(activeThreadId),
    [activeThreadId],
  );
  const requests = useSyncExternalStore(
    subscribePermissionRequests,
    getSnapshot,
  );

  if (!requests.length) return null;
  const current = requests[0]!;

  useEffect(() => {
    console.log("[agent-permission-request]", {
      source: "claude",
      threadId: current.threadKey,
      requestId: current.id,
      prompt: current.prompt,
      createdAt: current.createdAt,
    });
  }, [current.id, current.threadKey, current.prompt, current.createdAt]);

  return (
    <div className="aui-permission-approval-bar flex items-center justify-between rounded-lg border border-border/70 bg-background/95 px-3 py-2 text-sm shadow-sm">
      <p className="mr-3 line-clamp-2 text-foreground">{current.prompt}</p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            void respondToPermissionRequest(current.id, false);
          }}
        >
          Deny
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            void respondToPermissionRequest(current.id, true);
          }}
        >
          Approve
        </Button>
      </div>
    </div>
  );
};

const CREATE_BRANCH_OPTION = "__create_branch__";

const ComposerBranchControl: FC = () => {
  const threadId = useAuiState(({ threadListItem }) => threadListItem.remoteId ?? null);
  const isRunning = useAuiState(({ thread }) => thread.isRunning);
  const [cwd, setCwd] = useState<string | null>(null);
  const [repoMeta, setRepoMeta] = useState<WorkspaceRepoMeta | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [newBranchName, setNewBranchName] = useState("");
  const [isBranchDialogOpen, setIsBranchDialogOpen] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!threadId) {
        if (!cancelled) {
          setCwd(null);
          setRepoMeta(null);
          setBranches([]);
          setSelectedBranch("");
        }
        return;
      }

      const row = await db.threads.get(threadId);
      const threadCwd = row?.cwd?.trim() || null;
      if (!threadCwd) {
        if (!cancelled) {
          setCwd(null);
          setRepoMeta(null);
          setBranches([]);
          setSelectedBranch("");
        }
        return;
      }

      const [meta, branchOptions] = await Promise.all([
        getWorkspaceRepoMeta(threadCwd),
        listWorkspaceBranches(threadCwd),
      ]);

      if (cancelled) return;
      setCwd(threadCwd);
      setRepoMeta(meta);
      setBranches(branchOptions?.branches ?? []);
      setSelectedBranch(row?.git_branch?.trim() || branchOptions?.currentBranch || meta?.branch || "");
    };

    void load().catch(() => {
      if (!cancelled) {
        setRepoMeta(null);
        setBranches([]);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [threadId]);

  const applyExistingBranch = useCallback(
    async (nextBranch: string) => {
      if (!threadId || !cwd || !nextBranch.trim()) return;
      setError(null);
      setIsUpdating(true);
      try {
        const switched = await switchWorkspaceBranch(cwd, nextBranch);
        if (!switched) {
          setError("Could not switch to that branch.");
          return;
        }
        await db.threads.updateGitBranch(threadId, nextBranch.trim());
        setSelectedBranch(nextBranch.trim());
      } catch {
        setError("Could not switch branch.");
      } finally {
        setIsUpdating(false);
      }
    },
    [cwd, threadId],
  );

  const createAndApplyBranch = useCallback(async () => {
    if (!threadId || !cwd || !newBranchName.trim()) return;
    const candidate = newBranchName.trim();
    setError(null);
    setIsUpdating(true);
    try {
      const created = await createWorkspaceBranch(cwd, candidate);
      if (!created) {
        setError("Could not create branch. Check branch name.");
        return;
      }
      await db.threads.updateGitBranch(threadId, candidate);
      setSelectedBranch(candidate);
      setNewBranchName("");
      setIsBranchDialogOpen(false);
      const branchOptions = await listWorkspaceBranches(cwd);
      setBranches(branchOptions?.branches ?? []);
    } catch {
      setError("Could not create branch.");
    } finally {
      setIsUpdating(false);
    }
  }, [cwd, newBranchName, threadId]);

  if (!repoMeta) return null;

  const handleSelectChange = (value: string) => {
    if (value === CREATE_BRANCH_OPTION) {
      setIsBranchDialogOpen(true);
      return;
    }
    void applyExistingBranch(value);
  };

  return (
    <>
      <div className="aui-composer-chip max-w-[14rem]">
        {repoMeta.isGithub ? (
          <GithubIcon className="size-3 shrink-0 text-muted-foreground" />
        ) : (
          <GitBranchIcon className="size-3 shrink-0 text-muted-foreground" />
        )}
        <select
          value={selectedBranch}
          onChange={(event) => handleSelectChange(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-xs outline-none"
          disabled={isUpdating || isRunning}
          aria-label="Select thread branch"
          title={selectedBranch}
        >
          {selectedBranch ? null : <option value="">Select branch</option>}
          {branches.map((branch) => (
            <option key={branch} value={branch}>
              {branch}
            </option>
          ))}
          <option value={CREATE_BRANCH_OPTION}>Create new branch...</option>
        </select>
      </div>
      <Dialog open={isBranchDialogOpen} onOpenChange={setIsBranchDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Branch</DialogTitle>
            <DialogDescription>
              Enter a new branch name for this thread.
            </DialogDescription>
          </DialogHeader>
          <input
            value={newBranchName}
            onChange={(event) => setNewBranchName(event.target.value)}
            placeholder="feature/my-branch"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm outline-none"
            disabled={isUpdating}
          />
          {error ? <p className="text-destructive text-xs">{error}</p> : null}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setIsBranchDialogOpen(false)}
              disabled={isUpdating}
            >
              Cancel
            </Button>
            <Button onClick={() => void createAndApplyBranch()} disabled={isUpdating || !newBranchName.trim()}>
              Create and Switch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

const ComposerAction: FC = () => {
  const threadId = useAuiState(({ threadListItem }) => threadListItem.remoteId ?? null);
  const [modelId, setModelId] = useState<string>(() => {
    const stored = localStorage.getItem("pluribus:lastModel");
    return stored ?? "claude-opus-4-6";
  });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!threadId) return;
      const row = await db.threads.get(threadId);
      if (!cancelled) {
        setModelId(resolveModel(row?.model ?? null));
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [threadId]);

  return (
    <div className="aui-composer-action-wrapper relative mx-2 mb-2 flex items-center justify-between">
      <div className="flex min-w-0 items-center gap-2">
        <ComposerModelSelector modelId={modelId} onModelChange={setModelId} />
        <ComposerEffortSelector modelId={modelId} />
        <RunningElapsed />
        <ComposerBranchControl />
      </div>
      <AuiIf condition={(s) => !s.thread.isRunning}>
        <ComposerPrimitive.Send asChild>
          <TooltipIconButton
            tooltip="Send message"
            side="bottom"
            type="submit"
            variant="default"
            size="icon"
            className="aui-composer-send size-8 rounded-full"
            aria-label="Send message"
          >
            <ArrowUpIcon className="aui-composer-send-icon size-4" />
          </TooltipIconButton>
        </ComposerPrimitive.Send>
      </AuiIf>
      <AuiIf condition={(s) => s.thread.isRunning}>
        <ComposerPrimitive.Cancel asChild>
          <Button
            type="button"
            variant="default"
            size="icon"
            className="aui-composer-cancel size-8 rounded-full"
            aria-label="Stop generating"
          >
            <SquareIcon className="aui-composer-cancel-icon size-3 fill-current" />
          </Button>
        </ComposerPrimitive.Cancel>
      </AuiIf>
    </div>
  );
};

const RunningElapsed: FC = () => {
  const isRunning = useAuiState(({ thread }) => thread.isRunning);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!isRunning) {
      setElapsedSeconds(0);
      return;
    }

    const startedAt = Date.now();
    setElapsedSeconds(0);
    const intervalId = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isRunning]);

  if (!isRunning) return <div className="aui-running-elapsed text-muted-foreground">00:00</div>;

  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  const formatted = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  return (
    <div className="aui-running-elapsed text-muted-foreground">
      {formatted}
    </div>
  );
};

const ComposerModelSelector: FC<{ modelId: string; onModelChange: (id: string) => void }> = ({ modelId, onModelChange }) => {
  const threadId = useAuiState(({ threadListItem }) => threadListItem.remoteId ?? null);
  const isRunning = useAuiState(({ thread }) => thread.isRunning);
  const [open, setOpen] = useState(false);

  const model = getModelById(modelId);

  const handleSelect = async (id: string) => {
    onModelChange(id);
    setOpen(false);
    localStorage.setItem("pluribus:lastModel", id);
    if (threadId) {
      await db.threads.updateModel(threadId, id);
    }
    const newModel = getModelById(id);
    if (!newModel?.supportsEffort && threadId) {
      await db.threads.updateEffort(threadId, null);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={isRunning}>
        <button
          className="aui-composer-chip aui-composer-chip-interactive"
          aria-label="Select model"
        >
          <span className="aui-composer-chip-dot" />
          <span>{model?.label ?? modelId}</span>
          <ChevronDownIcon className="size-3 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="aui-model-popover w-auto min-w-[10rem] p-1"
        side="top"
        align="start"
        sideOffset={8}
      >
        <div className="px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">Claude</div>
        {CLAUDE_MODELS.map((m) => (
          <button
            key={m.id}
            className={`aui-model-option ${m.id === modelId ? "aui-model-option-active" : ""}`}
            onClick={() => void handleSelect(m.id)}
          >
            <span
              className="aui-composer-chip-dot"
              style={{ opacity: m.id === modelId ? 1 : 0.3 }}
            />
            <span>{m.label}</span>
            <span className="aui-model-option-family">{m.family}</span>
            <span className="ml-auto text-[0.58rem] text-muted-foreground/60">Agent SDK</span>
          </button>
        ))}
        <div className="mt-1 px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">Codex</div>
        {CODEX_MODELS.map((m) => (
          <button
            key={m.id}
            className={`aui-model-option ${m.id === modelId ? "aui-model-option-active" : ""}`}
            onClick={() => void handleSelect(m.id)}
          >
            <span
              className="aui-composer-chip-dot"
              style={{ opacity: m.id === modelId ? 1 : 0.3 }}
            />
            <span>{m.label}</span>
            <span className="aui-model-option-family">{m.family}</span>
            <span className="ml-auto text-[0.58rem] text-muted-foreground/60">Codex</span>
          </button>
        ))}
        <div className="mt-1 px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">Pi</div>
        {PI_MODELS.map((m) => (
          <button
            key={m.id}
            className={`aui-model-option ${m.id === modelId ? "aui-model-option-active" : ""}`}
            onClick={() => void handleSelect(m.id)}
          >
            <span
              className="aui-composer-chip-dot"
              style={{ opacity: m.id === modelId ? 1 : 0.3 }}
            />
            <span>{m.label}</span>
            <span className="aui-model-option-family">{m.family}</span>
            <span className="ml-auto text-[0.58rem] text-muted-foreground/60">Pi</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
};

const ComposerEffortSelector: FC<{ modelId: string }> = ({ modelId }) => {
  const threadId = useAuiState(({ threadListItem }) => threadListItem.remoteId ?? null);
  const isRunning = useAuiState(({ thread }) => thread.isRunning);
  const [effort, setEffort] = useState<EffortLevel>(() => {
    const stored = localStorage.getItem("pluribus:lastEffort");
    return (stored as EffortLevel) ?? "high";
  });
  const [open, setOpen] = useState(false);

  // Re-read effort from DB when thread changes or when model changes
  // (switching to a non-effort model clears effort in DB)
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!threadId) return;
      const row = await db.threads.get(threadId);
      if (!cancelled) {
        setEffort(resolveEffort(row?.effort ?? null));
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [threadId, modelId]);

  const model = getModelById(modelId);
  if (!model?.supportsEffort) return null;

  const effortLevels = isCodexModel(modelId) ? CODEX_EFFORT_LEVELS : EFFORT_LEVELS;

  const handleSelect = async (level: EffortLevel) => {
    setEffort(level);
    setOpen(false);
    localStorage.setItem("pluribus:lastEffort", level);
    if (threadId) {
      await db.threads.updateEffort(threadId, level);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={isRunning}>
        <button
          className="aui-composer-chip aui-composer-chip-interactive"
          aria-label="Select effort level"
        >
          <span className="aui-effort-dot" data-level={effort} />
          <span>{effort}</span>
          <ChevronDownIcon className="size-3 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="aui-model-popover w-auto min-w-[8rem] p-1"
        side="top"
        align="start"
        sideOffset={8}
      >
        {effortLevels.map((level) => (
          <button
            key={level}
            className={`aui-model-option ${level === effort ? "aui-model-option-active" : ""}`}
            onClick={() => void handleSelect(level)}
          >
            <span className="aui-effort-dot" data-level={level} style={{ opacity: level === effort ? 1 : 0.4 }} />
            <span>{level}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
};

const MessageError: FC = () => {
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className="aui-message-error-root mt-2 rounded-md border border-destructive bg-destructive/10 p-3 text-destructive text-sm dark:bg-destructive/5 dark:text-red-200">
        <ErrorPrimitive.Message className="aui-message-error-message line-clamp-2" />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  );
};

const AgentBadge: FC = () => {
  const remoteId = useAuiState(({ threadListItem }) => threadListItem.remoteId ?? null);
  const [modelId, setModelId] = useState<string | null>(null);

  useEffect(() => {
    if (!remoteId) {
      setModelId(null);
      return;
    }
    let cancelled = false;
    db.threads
      .get(remoteId)
      .then((row) => {
        if (!cancelled) setModelId(row?.model ?? null);
      })
      .catch(() => {
        if (!cancelled) setModelId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [remoteId]);

  if (!modelId) return null;

  const model = getModelById(modelId);
  if (!model) return null;

  const isCodex = isCodexModel(modelId);
  const providerType = isCodex ? "Codex" : "Agent SDK";
  const Icon = isCodex ? BrainCircuitIcon : BotIcon;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-default">
          <Icon className="size-3.5 text-muted-foreground" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="grid gap-1 text-xs">
        <div className="font-medium">{model.label}</div>
        <div className="text-muted-foreground">Provider: {providerType}</div>
        <div className="text-muted-foreground">Family: {model.family}</div>
      </TooltipContent>
    </Tooltip>
  );
};

const AssistantMessage: FC = () => {
  return (
    <MessagePrimitive.Root
      className="aui-assistant-message-root relative mx-auto w-full max-w-(--thread-max-width) py-3"
      data-role="assistant"
    >
      <div className="aui-assistant-message-content wrap-break-word px-2 text-foreground leading-relaxed">
        <MessagePrimitive.Parts
          components={{
            Text: MarkdownText,
            ChainOfThought: AgentChainOfThought,
          }}
        />
        <MessageError />
      </div>

      <div className="aui-assistant-message-footer mt-1 ml-2 flex items-center gap-3">
        <AgentBadge />
        <AssistantActionBar />
        <AssistantMessageMetrics />
      </div>
    </MessagePrimitive.Root>
  );
};

const ReasoningPart: FC<ReasoningMessagePartProps> = () => {
  return (
    <div className="aui-reasoning-part px-3 py-2 text-muted-foreground text-sm">
      <MarkdownText />
    </div>
  );
};

/**
 * Single dispatcher used inside ChainOfThoughtPrimitive.Parts, which only
 * accepts a Fallback (not a by_name map). Routes to the named tool component
 * for known tools, or to PiToolDisplay (generic) for anything else.
 */
const ChainOfThoughtToolDispatcher: ToolCallMessagePartComponent = (props) => {
  switch (props.toolName) {
    case "Task": return <TaskTool {...props} />;
    case "Read": return <ReadTool {...props} />;
    case "Edit": return <EditTool {...props} />;
    case "Write": return <WriteTool {...props} />;
    case "Bash": return <BashTool {...props} />;
    case "Grep": return <GrepTool {...props} />;
    case "Glob": return <GlobTool {...props} />;
    case "WebSearch": return <WebSearchTool {...props} />;
    case "WebFetch": return <WebFetchTool {...props} />;
    // Codex App Server item types
    case "file_change":
    case "command_execution":
    case "commandExecution":
    case "agent_message":
    case "agentMessage":
    case "web_search":
    case "webSearch":
    case "plan_update":
    case "planUpdate":
    case "mcp_tool_call":
    case "mcpToolCall":
    case "reasoning": return <CodexToolDisplay {...props} />;
    // Pi (`pi --mode rpc`) tool names are dynamic (native tools + Skills/
    // Extensions), so they fall through to PiToolDisplay, which renders a
    // generic args + result view (a graceful superset of ToolFallback).
    default: return <PiToolDisplay {...props} />;
  }
};

/**
 * Groups all thinking blocks and tool calls from an assistant message into
 * a single collapsible accordion, keeping the chat thread clean.
 * Text content parts still render outside this component.
 */
const AgentChainOfThought: FC = () => {
  return (
    <ChainOfThoughtPrimitive.Root className="aui-chain-of-thought my-2 overflow-hidden rounded-lg border border-border/60 bg-muted/20">
      <ChainOfThoughtPrimitive.AccordionTrigger className="flex w-full cursor-pointer select-none items-center gap-2 px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
        Agent activity
      </ChainOfThoughtPrimitive.AccordionTrigger>
      <ChainOfThoughtPrimitive.Parts
        components={{
          Reasoning: ReasoningPart,
          tools: { Fallback: ChainOfThoughtToolDispatcher },
          Layout: ({ children }) => (
            <div className="divide-y divide-border/40">{children}</div>
          ),
        }}
      />
    </ChainOfThoughtPrimitive.Root>
  );
};

type ClaudeMessageMetrics = {
  inputTokens?: number | null;
  outputTokens?: number | null;
  contextLeftBeforeCompaction?: number | null;
};

function formatInt(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return value.toLocaleString();
}

const AssistantMessageMetrics: FC = () => {
  const metrics = useAuiState(
    ({ message }) =>
      (message.metadata.custom?.claudeMessageMetrics as ClaudeMessageMetrics | undefined) ??
      undefined,
  );

  if (!metrics) return null;

  const inputTokens = typeof metrics.inputTokens === "number" ? metrics.inputTokens : null;
  const outputTokens = typeof metrics.outputTokens === "number" ? metrics.outputTokens : null;
  const totalTokens =
    inputTokens !== null || outputTokens !== null
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : null;

  return (
    <div className="aui-assistant-message-metrics text-muted-foreground text-xs">
      Tokens: {formatInt(totalTokens)} | Context left:{" "}
      {formatInt(metrics.contextLeftBeforeCompaction)}
    </div>
  );
};

const AssistantActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      autohideFloat="single-branch"
      className="aui-assistant-action-bar-root col-start-3 row-start-2 -ml-1 flex gap-1 text-muted-foreground data-floating:absolute data-floating:rounded-md data-floating:border data-floating:bg-background data-floating:p-1 data-floating:shadow-sm"
    >
      <ActionBarPrimitive.Copy asChild>
        <TooltipIconButton tooltip="Copy">
          <AuiIf condition={(s) => s.message.isCopied}>
            <CheckIcon />
          </AuiIf>
          <AuiIf condition={(s) => !s.message.isCopied}>
            <CopyIcon />
          </AuiIf>
        </TooltipIconButton>
      </ActionBarPrimitive.Copy>
      <ActionBarMorePrimitive.Root>
        <ActionBarMorePrimitive.Trigger asChild>
          <TooltipIconButton
            tooltip="More"
            className="data-[state=open]:bg-accent"
          >
            <MoreHorizontalIcon />
          </TooltipIconButton>
        </ActionBarMorePrimitive.Trigger>
        <ActionBarMorePrimitive.Content
          side="bottom"
          align="start"
          className="aui-action-bar-more-content z-50 min-w-32 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <ActionBarPrimitive.ExportMarkdown asChild>
            <ActionBarMorePrimitive.Item className="aui-action-bar-more-item flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground">
              <DownloadIcon className="size-4" />
              Export as Markdown
            </ActionBarMorePrimitive.Item>
          </ActionBarPrimitive.ExportMarkdown>
        </ActionBarMorePrimitive.Content>
      </ActionBarMorePrimitive.Root>
    </ActionBarPrimitive.Root>
  );
};

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root
      className="aui-user-message-root mx-auto grid w-full max-w-(--thread-max-width) auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 py-3 [&:where(>*)]:col-start-2"
      data-role="user"
    >
      <div className="aui-user-message-content-wrapper relative col-start-2 min-w-0">
        <div className="aui-user-message-content wrap-break-word px-4 py-2.5 text-foreground">
          <MessagePrimitive.Parts />
        </div>
      </div>
    </MessagePrimitive.Root>
  );
};
