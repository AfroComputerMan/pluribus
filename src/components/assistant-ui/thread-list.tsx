import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  db,
  DuplicateWorkspaceCwdError,
  type WorkspaceRow,
} from "@/lib/db";
import { getWorkspaceRepoMeta, type WorkspaceRepoMeta } from "@/lib/workspace-repo-metadata";
import { setPendingThreadOptions } from "@/lib/sqlite-thread-list-adapter";
import { invoke } from "@tauri-apps/api/core";
import { ThreadListPrimitive, useAui, useAuiState } from "@assistant-ui/react";
import {
  ArchiveIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FolderPlusIcon,
  FolderRootIcon,
  GitBranchIcon,
  GithubIcon,
  LoaderCircleIcon,
  PencilIcon,
  PlusIcon,
  SettingsIcon,
  TrashIcon,
  XIcon,
} from "lucide-react";
import { SettingsOverlay } from "@/components/settings-overlay";
import { useThreadStatusStore } from "@/lib/thread-status-store";
import type { FC, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ThreadSnapshot = {
  id: string;
  remoteId: string | null;
  title: string | null;
};

type ThreadMetaSnapshot = {
  workspaceId: string | null;
  cwd: string | null;
  gitBranch: string | null;
  modelId: string | null;
};

function basename(inputPath: string): string {
  const parts = inputPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? inputPath;
}

function getWorktreeLabel(cwd: string | null, repoRoot: string | undefined): string | null {
  if (!cwd) return null;
  if (!repoRoot) return basename(cwd);
  if (cwd === repoRoot) return "repo root";
  const unixPrefix = `${repoRoot}/`;
  if (cwd.startsWith(unixPrefix)) return cwd.slice(unixPrefix.length);
  const windowsPrefix = `${repoRoot}\\`;
  if (cwd.startsWith(windowsPrefix)) return cwd.slice(windowsPrefix.length);
  return cwd;
}

function ThreadDetailsTooltip({
  modelId,
  branch,
  worktree,
  repoMeta,
  children,
}: {
  modelId: string | null;
  branch: string | null;
  worktree: string | null;
  repoMeta?: WorkspaceRepoMeta;
  children: ReactNode;
}) {
  const modelLabel = modelId ?? "Default model";
  const branchLabel = branch || repoMeta?.branch || "unknown";

  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8} className="max-w-80 rounded-lg p-2.5">
        <div className="grid gap-1.5">
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="text-background/70">Model</span>
            <span className="truncate">{modelLabel}</span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px]">
            {repoMeta?.isGithub ? (
              <GithubIcon className="size-3.5 shrink-0" />
            ) : (
              <GitBranchIcon className="size-3.5 shrink-0" />
            )}
            <span className="truncate">{branchLabel}</span>
          </div>
          {worktree ? (
            <div className="flex items-center gap-1.5 text-[11px]">
              <FolderRootIcon className="size-3.5 shrink-0" />
              <span className="truncate">{worktree}</span>
            </div>
          ) : null}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function WorkspaceDetailsTooltip({
  repoMeta,
  workspacePath,
  children,
}: {
  repoMeta?: WorkspaceRepoMeta;
  workspacePath: string;
  children: ReactNode;
}) {
  const repoLabel = repoMeta?.repoSlug ?? repoMeta?.repoName ?? "No repository";

  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8} className="max-w-80 rounded-lg p-2.5">
        <div className="grid gap-1.5">
          <div className="flex items-center gap-1.5 text-[11px]">
            <FolderRootIcon className="size-3.5 shrink-0" />
            <span className="truncate">{workspacePath}</span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px]">
            {repoMeta?.isGithub ? (
              <GithubIcon className="size-3.5 shrink-0" />
            ) : (
              <GitBranchIcon className="size-3.5 shrink-0" />
            )}
            <span className="truncate">{repoLabel}</span>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export const ThreadList: FC = () => {
  const aui = useAui();
  const isLoading = useAuiState(({ threads }) => threads.isLoading);
  const mainThreadId = useAuiState(({ threads }) => threads.mainThreadId);

  useEffect(() => {
    const { setCurrentThread, markRead } = useThreadStatusStore.getState();
    setCurrentThread(mainThreadId ?? null);
    if (mainThreadId) markRead(mainThreadId);
  }, [mainThreadId]);

  const threadIds = useAuiState(({ threads }) => threads.threadIds);
  const threadItems = useAuiState(({ threads }) => threads.threadItems);
  const threads = useMemo<ThreadSnapshot[]>(() => {
    return threadIds.map((threadId) => {
      const item = threadItems.find((entry) => entry.id === threadId);
      return {
        id: threadId,
        remoteId: item?.remoteId ?? null,
        title: item?.title ?? null,
      };
    });
  }, [threadIds, threadItems]);

  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [threadMetaByRemoteId, setThreadMetaByRemoteId] = useState<
    Record<string, ThreadMetaSnapshot>
  >({});
  const [repoMetaByWorkspaceId, setRepoMetaByWorkspaceId] = useState<
    Record<string, WorkspaceRepoMeta>
  >({});
  const [threadMetaVersion, setThreadMetaVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [showWorkspaceForm, setShowWorkspaceForm] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [newWorkspaceCwd, setNewWorkspaceCwd] = useState("");
  const [isBrowsingWorkspaceDir, setIsBrowsingWorkspaceDir] = useState(false);
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const [workspaceCreationError, setWorkspaceCreationError] = useState<string | null>(null);

  const [creatingThreadWorkspaceId, setCreatingThreadWorkspaceId] = useState<string | null>(null);
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null);
  const [editingWorkspaceName, setEditingWorkspaceName] = useState("");

  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [editingThreadTitle, setEditingThreadTitle] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const editingThreadInputRef = useRef<HTMLInputElement>(null);

  const [deletingWorkspace, setDeletingWorkspace] = useState<WorkspaceRow | null>(null);
  const [isDeletingWorkspace, setIsDeletingWorkspace] = useState(false);

  const [showDeleteAllUnassigned, setShowDeleteAllUnassigned] = useState(false);
  const [isDeletingAllUnassigned, setIsDeletingAllUnassigned] = useState(false);
  const [collapsedWorkspaceIds, setCollapsedWorkspaceIds] = useState<Record<string, boolean>>({});
  // Tracks the workspace for a newly-switched thread before its first message (no remoteId yet).
  const [pendingNewThreadWorkspace, setPendingNewThreadWorkspace] = useState<{
    threadId: string;
    workspaceId: string;
  } | null>(null);

  // Clear pending workspace state when the thread navigates away or becomes initialized.
  useEffect(() => {
    if (!pendingNewThreadWorkspace) return;
    const { threadId } = pendingNewThreadWorkspace;
    // User navigated to a different thread.
    if (mainThreadId !== threadId) {
      setPendingNewThreadWorkspace(null);
      return;
    }
    // Thread was initialized (first message sent) — it now has a remoteId.
    const hasRemoteId = threads.some((t) => t.id === threadId && t.remoteId !== null);
    if (hasRemoteId) setPendingNewThreadWorkspace(null);
  }, [mainThreadId, pendingNewThreadWorkspace, threads]);

  const loadWorkspaces = useCallback(async () => {
    const rows = await db.workspaces.list();
    setWorkspaces(rows);
  }, []);

  useEffect(() => {
    void loadWorkspaces().catch((cause) => {
      const message =
        cause instanceof Error ? cause.message : "Failed to load workspaces.";
      setError(message);
    });
  }, [loadWorkspaces]);

  const remoteIds = useMemo(
    () => threads.map((thread) => thread.remoteId).filter((id): id is string => Boolean(id)),
    [threads],
  );

  useEffect(() => {
    let cancelled = false;
    const loadThreadMeta = async () => {
      if (!remoteIds.length) {
        if (!cancelled) setThreadMetaByRemoteId({});
        return;
      }

      const rows = await Promise.all(
        remoteIds.map(async (remoteId) => {
          const [threadRow, usageRow] = await Promise.all([
            db.threads.get(remoteId),
            db.usageSnapshots.getLatest(remoteId),
          ]);
          return { threadRow, usageRow };
        }),
      );
      const nextMap: Record<string, ThreadMetaSnapshot> = {};
      for (const { threadRow: row, usageRow } of rows) {
        if (!row?.remote_id) continue;
        nextMap[row.remote_id] = {
          workspaceId: row.workspace_id,
          cwd: row.cwd,
          gitBranch: row.git_branch,
          modelId: usageRow?.model_id ?? null,
        };
      }

      if (!cancelled) {
        setThreadMetaByRemoteId(nextMap);
      }
    };

    void loadThreadMeta().catch((cause) => {
      if (cancelled) return;
      const message =
        cause instanceof Error ? cause.message : "Failed to load thread metadata.";
      setError(message);
    });

    return () => {
      cancelled = true;
    };
  }, [remoteIds, threadMetaVersion]);

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

    void loadRepoMeta().catch((cause) => {
      if (cancelled) return;
      const message =
        cause instanceof Error ? cause.message : "Failed to load repository metadata.";
      setError(message);
    });

    return () => {
      cancelled = true;
    };
  }, [workspaces]);

  const createWorkspace = useCallback(async (options?: { cwd?: string; name?: string }) => {
    const cwd = (options?.cwd ?? newWorkspaceCwd).trim();
    if (!cwd) {
      setWorkspaceCreationError("Select a workspace directory.");
      return;
    }

    const enteredName = (options?.name ?? newWorkspaceName).trim();
    const repoMeta = await getWorkspaceRepoMeta(cwd);
    const defaultName = repoMeta?.repoName ?? basename(cwd);
    const name = enteredName
      ? enteredName === cwd
        ? defaultName
        : enteredName
      : defaultName;

    setError(null);
    setWorkspaceCreationError(null);
    setIsCreatingWorkspace(true);
    try {
      await db.workspaces.create(name, cwd);
      setNewWorkspaceName("");
      setNewWorkspaceCwd("");
      setShowWorkspaceForm(false);
      await loadWorkspaces();
    } catch (cause) {
      const message = cause instanceof DuplicateWorkspaceCwdError
        ? "This workspace already exists for the selected folder."
        : cause instanceof Error
          ? cause.message
          : "Failed to create workspace.";
      setWorkspaceCreationError(message);
    } finally {
      setIsCreatingWorkspace(false);
    }
  }, [loadWorkspaces, newWorkspaceCwd, newWorkspaceName]);

  const browseWorkspaceDirectory = useCallback(async () => {
    setError(null);
    setWorkspaceCreationError(null);
    setIsBrowsingWorkspaceDir(true);
    try {
      const selected = await invoke<string | string[] | null>("plugin:dialog|open", {
        options: {
          directory: true,
          multiple: false,
        },
      });

      const selectedPath =
        typeof selected === "string"
          ? selected
          : Array.isArray(selected)
            ? selected[0]
            : null;

      if (!selectedPath) return;

      const repoMeta = await getWorkspaceRepoMeta(selectedPath);
      const derivedName = repoMeta?.repoName ?? basename(selectedPath);
      setNewWorkspaceCwd(selectedPath);
      setNewWorkspaceName(derivedName);
      await createWorkspace({ cwd: selectedPath, name: derivedName });
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Failed to open directory picker.";
      setWorkspaceCreationError(message);
    } finally {
      setIsBrowsingWorkspaceDir(false);
    }
  }, [createWorkspace]);

  const createThreadInWorkspace = useCallback(
    async (workspace: WorkspaceRow) => {
      setError(null);
      setCreatingThreadWorkspaceId(workspace.id);
      try {
        await aui.threads().switchToNewThread();
        const threadId = aui.threads().getState().mainThreadId;
        setPendingThreadOptions(threadId, {
          workspaceId: workspace.id,
          cwd: workspace.cwd,
          model: localStorage.getItem("pluribus:lastModel"),
          effort: localStorage.getItem("pluribus:lastEffort"),
        });
        // Show the new thread under this workspace immediately (before first message).
        setPendingNewThreadWorkspace({ threadId, workspaceId: workspace.id });
        // Expand the workspace section so the new thread is visible.
        setCollapsedWorkspaceIds((prev) => ({ ...prev, [workspace.id]: false }));
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : "Failed to create thread.";
        setError(message);
      } finally {
        setCreatingThreadWorkspaceId(null);
      }
    },
    [aui],
  );

  const threadGroups = useMemo(() => {
    const groupedByWorkspace = new Map<string, ThreadSnapshot[]>();
    const unassigned: ThreadSnapshot[] = [];

    for (const thread of threads) {
      // Before the first message is sent, the thread has no remoteId. If this is the
      // pending new thread, place it under the intended workspace immediately.
      if (!thread.remoteId && pendingNewThreadWorkspace?.threadId === thread.id) {
        const current = groupedByWorkspace.get(pendingNewThreadWorkspace.workspaceId) ?? [];
        current.push(thread);
        groupedByWorkspace.set(pendingNewThreadWorkspace.workspaceId, current);
        continue;
      }

      const workspaceId =
        thread.remoteId ? threadMetaByRemoteId[thread.remoteId]?.workspaceId ?? null : null;
      if (!workspaceId) {
        unassigned.push(thread);
        continue;
      }

      const current = groupedByWorkspace.get(workspaceId) ?? [];
      current.push(thread);
      groupedByWorkspace.set(workspaceId, current);
    }

    return { groupedByWorkspace, unassigned };
  }, [threadMetaByRemoteId, threads, pendingNewThreadWorkspace]);

  const startWorkspaceRename = useCallback((workspace: WorkspaceRow) => {
    setEditingWorkspaceId(workspace.id);
    setEditingWorkspaceName(workspace.name);
  }, []);

  const confirmWorkspaceRename = useCallback(async () => {
    if (!editingWorkspaceId) return;
    const nextName = editingWorkspaceName.trim();
    if (!nextName) {
      setError("Workspace title cannot be empty.");
      return;
    }

    setError(null);
    try {
      await db.workspaces.rename(editingWorkspaceId, nextName);
      setEditingWorkspaceId(null);
      await loadWorkspaces();
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Failed to rename workspace.";
      setError(message);
    }
  }, [editingWorkspaceId, editingWorkspaceName, loadWorkspaces]);

  const deleteWorkspace = useCallback(
    async (cascade: boolean) => {
      if (!deletingWorkspace) return;
      setError(null);
      setIsDeletingWorkspace(true);
      try {
        await db.workspaces.delete(deletingWorkspace.id, cascade);
        setDeletingWorkspace(null);
        await loadWorkspaces();
        setThreadMetaVersion((v) => v + 1);
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : "Failed to delete workspace.";
        setError(message);
      } finally {
        setIsDeletingWorkspace(false);
      }
    },
    [deletingWorkspace, loadWorkspaces],
  );

  const startThreadRename = useCallback((thread: ThreadSnapshot) => {
    setEditingThreadId(thread.id);
    setEditingThreadTitle(thread.title ?? "");
    requestAnimationFrame(() => {
      editingThreadInputRef.current?.focus();
      editingThreadInputRef.current?.select();
    });
  }, []);

  const confirmThreadRename = useCallback(() => {
    if (!editingThreadId) return;
    const title = editingThreadTitle.trim();
    if (!title) {
      setEditingThreadId(null);
      return;
    }

    aui.threads().item({ id: editingThreadId }).rename(title);
    setEditingThreadId(null);
  }, [aui, editingThreadId, editingThreadTitle]);

  const deleteAllUnassigned = useCallback(async () => {
    setError(null);
    setIsDeletingAllUnassigned(true);
    try {
      for (const thread of threadGroups.unassigned) {
        aui.threads().item({ id: thread.id }).delete();
      }
      setShowDeleteAllUnassigned(false);
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Failed to delete unassigned threads.";
      setError(message);
    } finally {
      setIsDeletingAllUnassigned(false);
    }
  }, [aui, threadGroups.unassigned]);

  const switchToThread = useCallback(
    (threadId: string) => {
      useThreadStatusStore.getState().markRead(threadId);
      aui.threads().switchToThread(threadId);
    },
    [aui],
  );

  const toggleWorkspaceCollapsed = useCallback((workspaceId: string) => {
    setCollapsedWorkspaceIds((current) => ({
      ...current,
      [workspaceId]: !current[workspaceId],
    }));
  }, []);

  return (
    <ThreadListPrimitive.Root className="aui-root aui-thread-list-root flex flex-col">
      <div className="aui-sidebar-header space-y-3">
        <p className="aui-sidebar-brand">Pluribus</p>
        <Button
          variant="ghost"
          className="h-8 w-full justify-start px-2 text-sm"
          onClick={() => {
            void aui.threads().switchToNewThread();
          }}
        >
          <PlusIcon className="size-3.5" />
          New thread
        </Button>
      </div>
      <div className="aui-sidebar-body min-h-0 flex-1 overflow-y-auto pb-2">
      {error ? <p className="px-1 text-destructive text-xs">{error}</p> : null}

      {isLoading ? <ThreadListSkeleton /> : null}
      {!isLoading ? (
        <div className="flex flex-col gap-3">
          {workspaces.map((workspace) => {
            const threadsInWorkspace = threadGroups.groupedByWorkspace.get(workspace.id) ?? [];
            const isCreatingThread = creatingThreadWorkspaceId === workspace.id;
            const isEditingWorkspace = editingWorkspaceId === workspace.id;
            const isCollapsed = collapsedWorkspaceIds[workspace.id] ?? false;
            const repoMeta = repoMetaByWorkspaceId[workspace.id];
            const displayWorkspaceName = repoMeta?.repoName
              ?? (workspace.name.includes("/") || workspace.name.includes("\\")
                ? basename(workspace.name)
                : workspace.name);
            const workspacePath = repoMeta?.repoRoot ?? workspace.cwd;

            return (
              <section key={workspace.id} className="aui-workspace-card">
                <div className="mb-2 flex items-start justify-between gap-2 px-2">
                  <div className="min-w-0">
                    {isEditingWorkspace ? (
                      <div className="flex items-center gap-1">
                        <input
                          value={editingWorkspaceName}
                          onChange={(event) => setEditingWorkspaceName(event.target.value)}
                          className="h-7 w-full rounded border border-input bg-background px-2 text-sm outline-none"
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void confirmWorkspaceRename();
                            }
                            if (event.key === "Escape") {
                              event.preventDefault();
                              setEditingWorkspaceId(null);
                            }
                          }}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6"
                          onClick={() => void confirmWorkspaceRename()}
                        >
                          <CheckIcon className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6"
                          onClick={() => setEditingWorkspaceId(null)}
                        >
                          <XIcon className="size-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => toggleWorkspaceCollapsed(workspace.id)}
                            className="inline-flex size-5 items-center justify-center rounded hover:bg-muted"
                            aria-label={isCollapsed ? "Expand workspace section" : "Collapse workspace section"}
                          >
                            {isCollapsed ? (
                              <ChevronRightIcon className="size-3.5 text-muted-foreground" />
                            ) : (
                              <ChevronDownIcon className="size-3.5 text-muted-foreground" />
                            )}
                          </button>
                          <WorkspaceDetailsTooltip repoMeta={repoMeta} workspacePath={workspacePath}>
                            <p className="aui-workspace-title max-w-[9.6rem] cursor-help truncate">
                              {displayWorkspaceName}
                            </p>
                          </WorkspaceDetailsTooltip>
                          <span className="aui-workspace-count rounded-full border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {threadsInWorkspace.length}
                          </span>
                        </div>
                        {repoMeta ? (
                          <p className="aui-workspace-path mt-1 truncate text-[11px]" title={repoMeta.branch}>
                            {repoMeta.branch}
                          </p>
                        ) : null}
                        {repoMeta?.repoName && workspace.name !== repoMeta.repoName && !workspace.name.includes("/") ? (
                          <p className="truncate text-muted-foreground text-xs">
                            Workspace: {workspace.name}
                          </p>
                        ) : null}
                      </>
                    )}
                  </div>
                  {!isEditingWorkspace ? (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        onClick={() => startWorkspaceRename(workspace)}
                      >
                        <PencilIcon className="size-3.5" />
                        <span className="sr-only">Rename workspace</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-destructive"
                        onClick={() => setDeletingWorkspace(workspace)}
                      >
                        <TrashIcon className="size-3.5" />
                        <span className="sr-only">Delete workspace</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="aui-workspace-new-chat size-7"
                        onClick={() => void createThreadInWorkspace(workspace)}
                        disabled={Boolean(creatingThreadWorkspaceId)}
                        aria-label="New thread in workspace"
                      >
                        {isCreatingThread ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : <PlusIcon className="size-3.5" />}
                      </Button>
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-col gap-1 px-1">
                  {!isCollapsed ? (
                    threadsInWorkspace.length ? (
                      threadsInWorkspace.map((thread) => {
                        const isActive = thread.id === mainThreadId;
                        const isEditingThread = editingThreadId === thread.id;
                        const threadMeta =
                          thread.remoteId ? threadMetaByRemoteId[thread.remoteId] : undefined;
                        const threadBranch = threadMeta?.gitBranch ?? repoMeta?.branch ?? null;
                        const threadCwd = threadMeta?.cwd ?? workspace.cwd;
                        const threadWorktree = getWorktreeLabel(threadCwd, repoMeta?.repoRoot);
                        return (
                          <div
                            key={thread.id}
                            className="aui-thread-row group flex items-center gap-1 rounded-md hover:bg-muted data-[active=true]:bg-muted"
                            data-active={isActive ? "true" : undefined}
                          >
                            {isEditingThread ? (
                              <input
                                ref={editingThreadInputRef}
                                value={editingThreadTitle}
                                onChange={(event) => setEditingThreadTitle(event.target.value)}
                                onBlur={confirmThreadRename}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    confirmThreadRename();
                                  } else if (event.key === "Escape") {
                                    event.preventDefault();
                                    setEditingThreadId(null);
                                  }
                                }}
                                className="h-8 min-w-0 flex-1 rounded border border-input bg-background px-2 text-sm outline-none"
                              />
                            ) : (
                              <ThreadDetailsTooltip
                                modelId={threadMeta?.modelId ?? null}
                                branch={threadBranch}
                                worktree={threadWorktree}
                                repoMeta={repoMeta}
                              >
                                <button
                                  type="button"
                                  className="h-9 min-w-0 flex-1 px-2 text-left"
                                  onClick={() => switchToThread(thread.id)}
                                >
                                  <span className="block truncate text-sm">{thread.title ?? "New Thread"}</span>
                                </button>
                              </ThreadDetailsTooltip>
                            )}

                            <div className="aui-thread-row-actions mr-1 flex items-center opacity-0 transition-opacity group-hover:opacity-100 data-[active=true]:opacity-100">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-6"
                                onClick={() => startThreadRename(thread)}
                              >
                                <PencilIcon className="size-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-6"
                                onClick={() => aui.threads().item({ id: thread.id }).archive()}
                              >
                                <ArchiveIcon className="size-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-6 text-destructive"
                                onClick={() => aui.threads().item({ id: thread.id }).delete()}
                              >
                                <TrashIcon className="size-3.5" />
                              </Button>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <p className="px-2 py-1 text-muted-foreground text-xs">No chats yet.</p>
                    )
                  ) : null}
                </div>
              </section>
            );
          })}

          {!workspaces.length ? (
            <section className="aui-unassigned-card rounded-lg border border-dashed p-2">
              <p className="text-muted-foreground text-xs">
                Create a workspace to start grouping chats by project directory.
              </p>
            </section>
          ) : null}

          {threadGroups.unassigned.length ? (
            <section className="rounded-lg border border-dashed p-2">
              <div className="mb-2 flex items-center justify-between">
                <p className="font-medium text-sm">Unassigned</p>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-destructive"
                  onClick={() => setShowDeleteAllUnassigned(true)}
                >
                  <TrashIcon className="size-3.5" />
                  <span className="sr-only">Delete all unassigned</span>
                </Button>
              </div>
              <div className="flex flex-col gap-1">
                {threadGroups.unassigned.map((thread) => {
                  const isActive = thread.id === mainThreadId;
                  const isEditingThread = editingThreadId === thread.id;
                  const threadMeta =
                    thread.remoteId ? threadMetaByRemoteId[thread.remoteId] : undefined;
                  const unassignedWorktree = getWorktreeLabel(threadMeta?.cwd ?? null, undefined);

                  return (
                    <div
                      key={thread.id}
                      className="aui-thread-row group flex items-center gap-1 rounded-md hover:bg-muted data-[active=true]:bg-muted"
                      data-active={isActive ? "true" : undefined}
                    >
                      {isEditingThread ? (
                        <input
                          ref={editingThreadInputRef}
                          value={editingThreadTitle}
                          onChange={(event) => setEditingThreadTitle(event.target.value)}
                          onBlur={confirmThreadRename}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              confirmThreadRename();
                            } else if (event.key === "Escape") {
                              event.preventDefault();
                              setEditingThreadId(null);
                            }
                          }}
                          className="h-8 min-w-0 flex-1 rounded border border-input bg-background px-2 text-sm outline-none"
                        />
                      ) : (
                        <ThreadDetailsTooltip
                          modelId={threadMeta?.modelId ?? null}
                          branch={threadMeta?.gitBranch ?? null}
                          worktree={unassignedWorktree}
                        >
                          <button
                            type="button"
                            className="h-9 min-w-0 flex-1 px-2 text-left"
                            onClick={() => switchToThread(thread.id)}
                          >
                            <span className="block truncate text-sm">{thread.title ?? "New Thread"}</span>
                          </button>
                        </ThreadDetailsTooltip>
                      )}

                      <div className="aui-thread-row-actions mr-1 flex items-center opacity-0 transition-opacity group-hover:opacity-100 data-[active=true]:opacity-100">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6"
                          onClick={() => startThreadRename(thread)}
                        >
                          <PencilIcon className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6"
                          onClick={() => aui.threads().item({ id: thread.id }).archive()}
                        >
                          <ArchiveIcon className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6 text-destructive"
                          onClick={() => aui.threads().item({ id: thread.id }).delete()}
                        >
                          <TrashIcon className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
      </div>
      <div className="aui-sidebar-footer border-t border-border">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            className="h-8 flex-1 justify-start gap-2 px-2 text-sm"
            onClick={() => {
              setShowWorkspaceForm((prev) => !prev);
              setError(null);
              setWorkspaceCreationError(null);
            }}
          >
            <FolderPlusIcon className="size-4" />
            Add workspace
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setSettingsOpen(true)}
            aria-label="Settings"
            title="Settings"
          >
            <SettingsIcon className="size-4" />
          </Button>
        </div>
        {showWorkspaceForm ? (
          <div className="aui-workspace-form mt-2 grid gap-2 rounded-md border p-2">
            <input
              value={newWorkspaceName}
              onChange={(event) => setNewWorkspaceName(event.target.value)}
              placeholder="Workspace title"
              className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
              disabled={isCreatingWorkspace || isBrowsingWorkspaceDir}
            />
            <input
              value={newWorkspaceCwd}
              onChange={(event) => setNewWorkspaceCwd(event.target.value)}
              placeholder="/path/to/project"
              className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
              disabled={isCreatingWorkspace || isBrowsingWorkspaceDir}
            />
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void browseWorkspaceDirectory()}
                disabled={isCreatingWorkspace || isBrowsingWorkspaceDir}
                className="h-8"
              >
                Browse
              </Button>
              <Button
                size="sm"
                onClick={() => void createWorkspace()}
                disabled={isCreatingWorkspace || isBrowsingWorkspaceDir}
                className="h-8"
              >
                Create
              </Button>
            </div>
          </div>
        ) : null}
      </div>
      <Dialog
        open={Boolean(workspaceCreationError)}
        onOpenChange={(open) => {
          if (!open) setWorkspaceCreationError(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Workspace not created</DialogTitle>
            <DialogDescription>{workspaceCreationError}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setWorkspaceCreationError(null)}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(deletingWorkspace)}
        onOpenChange={(open) => {
          if (!open) setDeletingWorkspace(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete workspace: {deletingWorkspace?.name}</DialogTitle>
            <DialogDescription>
              This workspace and its directory reference will be removed. Choose what to do with
              its chats.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button
              variant="outline"
              disabled={isDeletingWorkspace}
              onClick={() => void deleteWorkspace(false)}
            >
              Keep chats (move to Unassigned)
            </Button>
            <Button
              variant="destructive"
              disabled={isDeletingWorkspace}
              onClick={() => void deleteWorkspace(true)}
            >
              Delete workspace and all chats
            </Button>
            <Button
              variant="ghost"
              disabled={isDeletingWorkspace}
              onClick={() => setDeletingWorkspace(null)}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={showDeleteAllUnassigned}
        onOpenChange={(open) => {
          if (!open) setShowDeleteAllUnassigned(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete all unassigned chats</DialogTitle>
            <DialogDescription>
              This will permanently delete {threadGroups.unassigned.length} unassigned{" "}
              {threadGroups.unassigned.length === 1 ? "chat" : "chats"} and their messages.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={isDeletingAllUnassigned}
              onClick={() => setShowDeleteAllUnassigned(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={isDeletingAllUnassigned}
              onClick={() => void deleteAllUnassigned()}
            >
              Delete all
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <SettingsOverlay
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        workspaces={workspaces.map((w) => ({ id: w.id, name: w.name, cwd: w.cwd }))}
        currentThread={(() => {
          const active = threads.find((t) => t.id === mainThreadId);
          return active ? { id: active.id, title: active.title ?? "Untitled" } : null;
        })()}
      />
    </ThreadListPrimitive.Root>
  );
};

const ThreadListSkeleton: FC = () => {
  return (
    <div className="aui-thread-list-skeleton-group flex flex-col gap-1">
      {Array.from({ length: 5 }, (_, i) => (
        <div
          key={i}
          role="status"
          aria-label="Loading threads"
          className="aui-thread-list-skeleton-wrapper flex h-9 items-center px-3"
        >
          <Skeleton className="aui-thread-list-skeleton h-4 w-full" />
        </div>
      ))}
    </div>
  );
};
