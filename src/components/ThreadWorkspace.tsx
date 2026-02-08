import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Thread } from "@/components/assistant-ui/thread";
import { RuntimeProvider } from "@/components/RuntimeProvider";
import { MessageSquareIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

type ThreadItem = {
  id: string;
  title: string;
  createdAt: number;
};

function createThread(): ThreadItem {
  return {
    id: crypto.randomUUID(),
    title: "New Thread",
    createdAt: Date.now(),
  };
}

function generateTitleFromPrompt(prompt: string): string {
  const firstLine = prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstLine) return "New Thread";
  const maxLen = 56;
  return firstLine.length > maxLen ? `${firstLine.slice(0, maxLen - 1)}…` : firstLine;
}

export function ThreadWorkspace() {
  const [threads, setThreads] = useState<ThreadItem[]>(() => [createThread()]);
  const [activeThreadId, setActiveThreadId] = useState<string>(() => threads[0]!.id);

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) ?? threads[0],
    [threads, activeThreadId],
  );

  const handleCreateThread = useCallback(() => {
    const newThread = createThread();
    setThreads((prev) => [...prev, newThread]);
    setActiveThreadId(newThread.id);
  }, []);

  const handleDeleteThread = useCallback(
    (threadId: string) => {
      setThreads((prev) => {
        if (prev.length <= 1) {
          const next = createThread();
          setActiveThreadId(next.id);
          return [next];
        }

        const nextThreads = prev.filter((thread) => thread.id !== threadId);
        if (activeThreadId === threadId) {
          const replacement = nextThreads[nextThreads.length - 1];
          if (replacement) {
            setActiveThreadId(replacement.id);
          }
        }
        return nextThreads;
      });
    },
    [activeThreadId],
  );

  const handleUserPrompt = useCallback((threadId: string, prompt: string) => {
    const generated = generateTitleFromPrompt(prompt);
    setThreads((prev) =>
      prev.map((thread) => {
        if (thread.id !== threadId) return thread;
        if (thread.title !== "New Thread") return thread;
        return { ...thread, title: generated };
      }),
    );
  }, []);

  const onActiveThreadPrompt = useMemo(() => {
    if (!activeThread) return undefined;
    const threadId = activeThread.id;
    return (prompt: string) => handleUserPrompt(threadId, prompt);
  }, [activeThread, handleUserPrompt]);

  return (
    <div className="flex h-full w-full">
      <aside className="flex h-full w-72 shrink-0 flex-col border-r bg-card/60">
        <div className="border-b p-3">
          <Button className="w-full justify-start gap-2" onClick={handleCreateThread}>
            <PlusIcon className="size-4" />
            New Thread
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <div className="space-y-1">
            {threads.map((thread) => {
              const isActive = thread.id === activeThread?.id;
              return (
                <div
                  key={thread.id}
                  className={cn(
                    "group flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm",
                    isActive ? "bg-muted border-primary/50" : "hover:bg-muted/60",
                  )}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left"
                    onClick={() => setActiveThreadId(thread.id)}
                    title={thread.title}
                  >
                    <span className="mr-2 inline-flex align-middle text-muted-foreground">
                      <MessageSquareIcon className="size-3.5" />
                    </span>
                    {thread.title}
                  </button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="opacity-60 hover:opacity-100"
                    onClick={() => handleDeleteThread(thread.id)}
                    aria-label={`Delete ${thread.title}`}
                  >
                    <Trash2Icon className="size-3" />
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      </aside>

      <section className="relative h-full min-w-0 flex-1">
        {activeThread ? (
          <div className="absolute inset-0">
            <RuntimeProvider
              key={activeThread.id}
              threadKey={`local-thread:${activeThread.id}`}
              onUserPrompt={onActiveThreadPrompt}
            >
              <Thread />
            </RuntimeProvider>
          </div>
        ) : null}
      </section>
    </div>
  );
}
