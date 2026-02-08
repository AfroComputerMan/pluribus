import { Thread } from "@/components/assistant-ui/thread";
import { ThreadList } from "@/components/assistant-ui/thread-list";

export function ThreadWorkspace() {
  return (
    <div className="flex h-full w-full">
      <aside className="flex h-full w-72 shrink-0 flex-col border-r bg-card/60">
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <ThreadList />
        </div>
      </aside>

      <section className="relative h-full min-w-0 flex-1">
        <div className="absolute inset-0">
          <Thread />
        </div>
      </section>
    </div>
  );
}
