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
import { setPendingThreadCwd } from "@/lib/sqlite-thread-list-adapter";
import { invoke } from "@tauri-apps/api/core";
import {
  AuiIf,
  ThreadListItemMorePrimitive,
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  useAui,
  useAuiState,
} from "@assistant-ui/react";
import {
  ArchiveIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from "lucide-react";
import type { FC } from "react";
import { useCallback, useRef, useState } from "react";

export const ThreadList: FC = () => {
  return (
    <ThreadListPrimitive.Root className="aui-root aui-thread-list-root flex flex-col gap-1">
      <ThreadListNew />
      <AuiIf condition={(s) => s.threads.isLoading}>
        <ThreadListSkeleton />
      </AuiIf>
      <AuiIf condition={(s) => !s.threads.isLoading}>
        <ThreadListPrimitive.Items components={{ ThreadListItem }} />
      </AuiIf>
    </ThreadListPrimitive.Root>
  );
};

const ThreadListNew: FC = () => {
  const aui = useAui();
  const isMainNew = useAuiState(
    ({ threads }) => threads.newThreadId === threads.mainThreadId,
  );
  const [open, setOpen] = useState(false);
  const [cwd, setCwd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isBrowsing, setIsBrowsing] = useState(false);

  const browseDirectory = useCallback(async () => {
    setError(null);
    setIsBrowsing(true);
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
        setCwd(selectedPath);
      }
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Failed to open directory picker.";
      setError(message);
    } finally {
      setIsBrowsing(false);
    }
  }, []);

  const createThread = useCallback(async () => {
    const normalizedCwd = cwd.trim();
    if (!normalizedCwd) {
      setError("Enter a directory path.");
      return;
    }

    setError(null);
    setIsCreating(true);
    try {
      await aui.threads().switchToNewThread();
      const threadId = aui.threads().getState().mainThreadId;
      setPendingThreadCwd(threadId, normalizedCwd);
      setOpen(false);
      setCwd("");
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Failed to create thread.";
      setError(message);
    } finally {
      setIsCreating(false);
    }
  }, [aui, cwd]);

  return (
    <>
      <Button
        variant="outline"
        className="aui-thread-list-new h-9 justify-start gap-2 rounded-lg px-3 text-sm hover:bg-muted data-active:bg-muted"
        data-active={isMainNew ? "true" : undefined}
        aria-current={isMainNew ? "true" : undefined}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        <PlusIcon className="size-4" />
        New Thread
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Thread Directory</DialogTitle>
            <DialogDescription>
              Set the working directory for this thread.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <label htmlFor="thread-cwd-input" className="text-sm font-medium">
              Directory path
            </label>
            <input
              id="thread-cwd-input"
              value={cwd}
              onChange={(event) => setCwd(event.target.value)}
              placeholder="/path/to/project"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void createThread();
                }
              }}
              disabled={isCreating || isBrowsing}
              autoFocus
            />
            <Button
              variant="outline"
              onClick={() => void browseDirectory()}
              disabled={isCreating || isBrowsing}
              className="justify-start"
            >
              Browse...
            </Button>
            {error ? <p className="text-destructive text-xs">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isCreating || isBrowsing}
            >
              Cancel
            </Button>
            <Button onClick={() => void createThread()} disabled={isCreating || isBrowsing}>
              Create Thread
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

const ThreadListSkeleton: FC = () => {
  return (
    <div className="flex flex-col gap-1">
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

const ThreadListItem: FC = () => {
  const aui = useAui();
  const title = useAuiState(({ threadListItem }) => threadListItem.title);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const startEditing = useCallback(() => {
    setEditValue(title ?? "");
    setIsEditing(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [title]);

  const confirmRename = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== title) {
      aui.threadListItem().rename(trimmed);
    }
    setIsEditing(false);
  }, [aui, editValue, title]);

  const cancelEditing = useCallback(() => {
    setIsEditing(false);
  }, []);

  return (
    <ThreadListItemPrimitive.Root className="aui-thread-list-item group flex h-9 items-center gap-2 rounded-lg transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none data-active:bg-muted">
      {isEditing ? (
        <input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              confirmRename();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancelEditing();
            }
          }}
          onBlur={confirmRename}
          className="flex h-full min-w-0 flex-1 items-center truncate bg-transparent px-3 text-start text-sm outline-none ring-1 ring-ring/30 rounded"
        />
      ) : (
        <ThreadListItemPrimitive.Trigger className="aui-thread-list-item-trigger flex h-full min-w-0 flex-1 items-center truncate px-3 text-start text-sm">
          <ThreadListItemPrimitive.Title fallback="New Thread" />
        </ThreadListItemPrimitive.Trigger>
      )}
      <ThreadListItemMore onRename={startEditing} />
    </ThreadListItemPrimitive.Root>
  );
};

const ThreadListItemMore: FC<{ onRename: () => void }> = ({ onRename }) => {
  return (
    <ThreadListItemMorePrimitive.Root>
      <ThreadListItemMorePrimitive.Trigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="aui-thread-list-item-more mr-2 size-7 p-0 opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:bg-accent data-[state=open]:opacity-100 group-data-active:opacity-100"
        >
          <MoreHorizontalIcon className="size-4" />
          <span className="sr-only">More options</span>
        </Button>
      </ThreadListItemMorePrimitive.Trigger>
      <ThreadListItemMorePrimitive.Content
        side="bottom"
        align="start"
        className="aui-thread-list-item-more-content z-50 min-w-32 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
      >
        <ThreadListItemMorePrimitive.Item
          onSelect={onRename}
          className="aui-thread-list-item-more-item flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
        >
          <PencilIcon className="size-4" />
          Rename
        </ThreadListItemMorePrimitive.Item>
        <ThreadListItemPrimitive.Archive asChild>
          <ThreadListItemMorePrimitive.Item className="aui-thread-list-item-more-item flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground">
            <ArchiveIcon className="size-4" />
            Archive
          </ThreadListItemMorePrimitive.Item>
        </ThreadListItemPrimitive.Archive>
        <ThreadListItemPrimitive.Delete asChild>
          <ThreadListItemMorePrimitive.Item className="aui-thread-list-item-more-item flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-destructive text-sm outline-none hover:bg-destructive/10 hover:text-destructive focus:bg-destructive/10 focus:text-destructive">
            <TrashIcon className="size-4" />
            Delete
          </ThreadListItemMorePrimitive.Item>
        </ThreadListItemPrimitive.Delete>
      </ThreadListItemMorePrimitive.Content>
    </ThreadListItemMorePrimitive.Root>
  );
};
