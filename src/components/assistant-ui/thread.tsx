import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
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
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { Button } from "@/components/ui/button";
import { useVisualLayoutId } from "@/lib/visual-layout-context";
import {
  getClaudePermissionRequests,
  respondToClaudePermissionRequest,
  subscribeClaudePermissionRequests,
} from "@/lib/claude-adapter";
import { db, type WorkspaceRow } from "@/lib/db";
import { setPendingThreadOptions } from "@/lib/sqlite-thread-list-adapter";
import {
  ActionBarMorePrimitive,
  ActionBarPrimitive,
  AuiIf,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  type ReasoningGroupProps,
  type ReasoningMessagePartProps,
} from "@assistant-ui/react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  FolderOpenIcon,
  LoaderCircleIcon,
  MoreHorizontalIcon,
  SquareIcon,
} from "lucide-react";
import { type FC, useCallback, useEffect, useState, useSyncExternalStore } from "react";

/** Hook to check whether the current thread has a workspace assigned. */
function useThreadWorkspace() {
  const remoteId = useAuiState(({ threadListItem }) => threadListItem.remoteId ?? null);
  const isEmpty = useAuiState(({ thread }) => thread.isEmpty);

  // null = still loading, true/false = resolved
  const [hasWorkspace, setHasWorkspace] = useState<boolean | null>(null);

  useEffect(() => {
    if (!remoteId) {
      setHasWorkspace(false);
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
  }, [remoteId]);

  return { remoteId, isEmpty, hasWorkspace, setHasWorkspace };
}

export const Thread: FC = () => {
  const layoutId = useVisualLayoutId();
  const { remoteId, isEmpty, hasWorkspace, setHasWorkspace } = useThreadWorkspace();
  const needsWorkspace = isEmpty && hasWorkspace === false;

  return (
    <ThreadPrimitive.Root
      className="aui-root aui-thread-root @container flex h-full flex-col bg-background"
      data-layout={layoutId}
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
            threadId={remoteId}
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

        <ThreadPrimitive.ViewportFooter className="aui-thread-viewport-footer sticky bottom-0 mx-auto mt-auto flex w-full max-w-(--thread-max-width) flex-col gap-4 overflow-visible rounded-t-3xl pb-4 md:pb-6">
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
          <h1 className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in font-semibold text-2xl duration-200">
            Hello there!
          </h1>
          <p className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in text-muted-foreground text-xl delay-75 duration-200">
            How can I help you today?
          </p>
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
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    db.workspaces
      .list()
      .then((rows) => {
        if (!cancelled) {
          setWorkspaces(rows);
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

  const selectWorkspace = useCallback(
    async (workspace: WorkspaceRow) => {
      if (!threadId) return;
      await db.threads.updateWorkspace(threadId, workspace.id, workspace.cwd);
      setPendingThreadOptions(threadId, {
        workspaceId: workspace.id,
        cwd: workspace.cwd,
      });
      onWorkspaceSelected();
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
          </div>

          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <LoaderCircleIcon className="size-4 animate-spin" />
              Loading workspaces...
            </div>
          ) : workspaces.length ? (
            <div className="flex flex-col gap-2">
              {workspaces.map((workspace) => (
                <button
                  key={workspace.id}
                  type="button"
                  className="flex items-center gap-3 rounded-lg border bg-card/60 px-4 py-3 text-left transition-colors hover:bg-muted"
                  onClick={() => void selectWorkspace(workspace)}
                >
                  <FolderOpenIcon className="size-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-sm">{workspace.name}</p>
                    <p className="truncate text-muted-foreground text-xs">{workspace.cwd}</p>
                  </div>
                </button>
              ))}
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
  const layoutId = useVisualLayoutId();

  return (
    <ComposerPrimitive.Root
      className="aui-composer-root relative flex w-full flex-col"
      data-layout={layoutId}
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
    () => getClaudePermissionRequests(activeThreadId),
    [activeThreadId],
  );
  const requests = useSyncExternalStore(
    subscribeClaudePermissionRequests,
    getSnapshot,
  );

  if (!requests.length) return null;
  const current = requests[0]!;

  return (
    <div className="aui-permission-approval-bar flex items-center justify-between rounded-lg border border-border/70 bg-background/95 px-3 py-2 text-sm shadow-sm">
      <p className="mr-3 line-clamp-2 text-foreground">{current.prompt}</p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            void respondToClaudePermissionRequest(current.id, false);
          }}
        >
          Deny
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            void respondToClaudePermissionRequest(current.id, true);
          }}
        >
          Approve
        </Button>
      </div>
    </div>
  );
};

const ComposerAction: FC = () => {
  return (
    <div className="aui-composer-action-wrapper relative mx-2 mb-2 flex items-center justify-between">
      <RunningElapsed />
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

  if (!isRunning) return <div />;

  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  const formatted = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  const loader = <LoaderCircleIcon className="size-3.5 animate-spin" />;

  return (
    <div className="aui-running-elapsed flex items-center gap-1.5 text-muted-foreground text-xs">
      {loader}
      <span>{formatted}</span>
    </div>
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

const AssistantMessage: FC = () => {
  const layoutId = useVisualLayoutId();
  const agentLabel = "Assistant";

  return (
    <MessagePrimitive.Root
      className="aui-assistant-message-root fade-in slide-in-from-bottom-1 relative mx-auto w-full max-w-(--thread-max-width) animate-in py-3 duration-150"
      data-role="assistant"
      data-layout={layoutId}
    >
      <div className="aui-assistant-message-head mb-1 ml-2 inline-flex items-center gap-2">
        <span className="aui-agent-dot inline-flex size-2 rounded-full bg-primary" />
        <span className="aui-agent-label font-semibold text-[0.66rem] uppercase tracking-[0.16em] text-muted-foreground">
          {agentLabel}
        </span>
      </div>

      <div className="aui-assistant-message-content wrap-break-word px-2 text-foreground leading-relaxed">
        <MessagePrimitive.Parts
          components={{
            Text: MarkdownText,
            Reasoning: ReasoningPart,
            ReasoningGroup,
            tools: {
              by_name: {
                Task: TaskTool,
                Read: ReadTool,
                Edit: EditTool,
                Write: WriteTool,
                Bash: BashTool,
                Grep: GrepTool,
                Glob: GlobTool,
                WebSearch: WebSearchTool,
                WebFetch: WebFetchTool,
              },
              Fallback: ToolFallback,
            },
          }}
        />
        <MessageError />
      </div>

      <div className="aui-assistant-message-footer mt-1 ml-2 flex items-center gap-3">
        <AssistantActionBar />
        <AssistantMessageMetrics />
      </div>
    </MessagePrimitive.Root>
  );
};

const ReasoningGroup: FC<ReasoningGroupProps> = ({ children }) => {
  return (
    <details
      open
      className="aui-reasoning-group my-2 overflow-hidden rounded-lg border border-border/60 bg-muted/30"
    >
      <summary className="cursor-pointer px-3 py-2 font-medium text-muted-foreground text-xs">
        Claude thinking
      </summary>
      <div className="px-3 pb-3">{children}</div>
    </details>
  );
};

const ReasoningPart: FC<ReasoningMessagePartProps> = () => {
  return (
    <div className="aui-reasoning-part text-muted-foreground text-sm">
      <MarkdownText />
    </div>
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
  const layoutId = useVisualLayoutId();

  return (
    <MessagePrimitive.Root
      className="aui-user-message-root fade-in slide-in-from-bottom-1 mx-auto grid w-full max-w-(--thread-max-width) animate-in auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 py-3 duration-150 [&:where(>*)]:col-start-2"
      data-role="user"
      data-layout={layoutId}
    >
      <div className="aui-user-message-head col-start-2 inline-flex items-center justify-end">
        <span className="aui-user-label rounded-full border border-border/70 px-2 py-0.5 font-medium text-[0.66rem] uppercase tracking-[0.16em] text-muted-foreground">
          You
        </span>
      </div>
      <div className="aui-user-message-content-wrapper relative col-start-2 min-w-0">
        <div className="aui-user-message-content wrap-break-word rounded-2xl bg-muted px-4 py-2.5 text-foreground">
          <MessagePrimitive.Parts />
        </div>
      </div>
    </MessagePrimitive.Root>
  );
};
