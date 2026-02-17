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
import { db, type WorkspaceRow } from "@/lib/db";
import { useVisualLayoutId } from "@/lib/visual-layout-context";
import { setPendingThreadOptions } from "@/lib/sqlite-thread-list-adapter";
import { invoke } from "@tauri-apps/api/core";
import { ThreadListPrimitive, useAui, useAuiState } from "@assistant-ui/react";
import {
  ArchiveIcon,
  CheckIcon,
  FolderPlusIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  XIcon,
} from "lucide-react";
import type { FC } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ThreadSnapshot = {
  id: string;
  remoteId: string | null;
  title: string | null;
};

type ThreadMetaSnapshot = {
  workspaceId: string | null;
};

export const ThreadList: FC = () => {
  const layoutId = useVisualLayoutId();
  const aui = useAui();
  const isLoading = useAuiState(({ threads }) => threads.isLoading);
  const mainThreadId = useAuiState(({ threads }) => threads.mainThreadId);
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
  const [threadMetaVersion, setThreadMetaVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [showWorkspaceForm, setShowWorkspaceForm] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [newWorkspaceCwd, setNewWorkspaceCwd] = useState("");
  const [isBrowsingWorkspaceDir, setIsBrowsingWorkspaceDir] = useState(false);
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);

  const [creatingThreadWorkspaceId, setCreatingThreadWorkspaceId] = useState<string | null>(null);
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null);
  const [editingWorkspaceName, setEditingWorkspaceName] = useState("");

  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [editingThreadTitle, setEditingThreadTitle] = useState("");
  const editingThreadInputRef = useRef<HTMLInputElement>(null);

  const [deletingWorkspace, setDeletingWorkspace] = useState<WorkspaceRow | null>(null);
  const [isDeletingWorkspace, setIsDeletingWorkspace] = useState(false);

  const [showDeleteAllUnassigned, setShowDeleteAllUnassigned] = useState(false);
  const [isDeletingAllUnassigned, setIsDeletingAllUnassigned] = useState(false);

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

      const rows = await Promise.all(remoteIds.map((remoteId) => db.threads.get(remoteId)));
      const nextMap: Record<string, ThreadMetaSnapshot> = {};
      for (const row of rows) {
        if (!row?.remote_id) continue;
        nextMap[row.remote_id] = {
          workspaceId: row.workspace_id,
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

  const browseWorkspaceDirectory = useCallback(async () => {
    setError(null);
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

      if (selectedPath) {
        setNewWorkspaceCwd(selectedPath);
        if (!newWorkspaceName.trim()) {
          const parts = selectedPath.split(/[\\/]/).filter(Boolean);
          const basename = parts[parts.length - 1] ?? selectedPath;
          setNewWorkspaceName(basename);
        }
      }
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Failed to open directory picker.";
      setError(message);
    } finally {
      setIsBrowsingWorkspaceDir(false);
    }
  }, [newWorkspaceName]);

  const createWorkspace = useCallback(async () => {
    const name = newWorkspaceName.trim();
    const cwd = newWorkspaceCwd.trim();
    if (!name) {
      setError("Enter a workspace name.");
      return;
    }
    if (!cwd) {
      setError("Enter a workspace directory.");
      return;
    }

    setError(null);
    setIsCreatingWorkspace(true);
    try {
      await db.workspaces.create(name, cwd);
      setNewWorkspaceName("");
      setNewWorkspaceCwd("");
      setShowWorkspaceForm(false);
      await loadWorkspaces();
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Failed to create workspace.";
      setError(message);
    } finally {
      setIsCreatingWorkspace(false);
    }
  }, [loadWorkspaces, newWorkspaceCwd, newWorkspaceName]);

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
        });
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
  }, [threadMetaByRemoteId, threads]);

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
      aui.threads().switchToThread(threadId);
    },
    [aui],
  );

  return (
    <ThreadListPrimitive.Root
      className="aui-root aui-thread-list-root flex flex-col gap-2"
      data-layout={layoutId}
    >
      <div className="flex items-center justify-between px-1">
        <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          Workspaces
        </p>
      </div>
      <Button
        variant="outline"
        className="aui-thread-list-create-workspace h-8 justify-start gap-2"
        onClick={() => {
          setShowWorkspaceForm((prev) => !prev);
          setError(null);
        }}
      >
        <FolderPlusIcon className="size-4" />
        New Workspace
      </Button>

      {showWorkspaceForm ? (
        <div className="aui-workspace-form grid gap-2 rounded-md border p-2">
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

      {error ? <p className="px-1 text-destructive text-xs">{error}</p> : null}

      {isLoading ? <ThreadListSkeleton layoutId={layoutId} /> : null}
      {!isLoading ? (
        <div className="flex flex-col gap-3">
          {workspaces.map((workspace) => {
            const threadsInWorkspace = threadGroups.groupedByWorkspace.get(workspace.id) ?? [];
            const isCreatingThread = creatingThreadWorkspaceId === workspace.id;
            const isEditingWorkspace = editingWorkspaceId === workspace.id;

            return (
              <section key={workspace.id} className="aui-workspace-card rounded-lg border bg-card/40 p-2">
                <div className="mb-2 flex items-start justify-between gap-2">
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
                        <div className="flex items-center gap-2">
                          <p className="truncate font-medium text-sm">{workspace.name}</p>
                          <span className="aui-workspace-count rounded-full border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {threadsInWorkspace.length}
                          </span>
                        </div>
                        <p className="aui-workspace-path truncate text-muted-foreground text-xs">
                          {workspace.cwd}
                        </p>
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
                        variant="outline"
                        size="sm"
                        className="aui-workspace-new-chat h-7 px-2"
                        onClick={() => void createThreadInWorkspace(workspace)}
                        disabled={Boolean(creatingThreadWorkspaceId)}
                      >
                        <PlusIcon className="mr-1 size-3.5" />
                        {isCreatingThread ? "Creating" : "New Chat"}
                      </Button>
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-col gap-1">
                  {threadsInWorkspace.length ? (
                    threadsInWorkspace.map((thread) => {
                      const isActive = thread.id === mainThreadId;
                      const isEditingThread = editingThreadId === thread.id;

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
                            <button
                              type="button"
                              className="h-10 min-w-0 flex-1 px-2 text-left"
                              onClick={() => switchToThread(thread.id)}
                            >
                              <span className="block truncate text-sm">{thread.title ?? "New Thread"}</span>
                              <span className="block text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                                {isActive ? "Active chat" : "Workspace chat"}
                              </span>
                            </button>
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
                  )}
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
                        <button
                          type="button"
                          className="h-10 min-w-0 flex-1 px-2 text-left"
                          onClick={() => switchToThread(thread.id)}
                        >
                          <span className="block truncate text-sm">{thread.title ?? "New Thread"}</span>
                          <span className="block text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                            {isActive ? "Active chat" : "Unassigned"}
                          </span>
                        </button>
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
    </ThreadListPrimitive.Root>
  );
};

const ThreadListSkeleton: FC<{ layoutId: string }> = ({ layoutId }) => {
  return (
    <div className="aui-thread-list-skeleton-group flex flex-col gap-1" data-layout={layoutId}>
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
