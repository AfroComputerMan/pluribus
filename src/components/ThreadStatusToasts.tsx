import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useAui } from "@assistant-ui/react";
import {
  useThreadStatusStore,
  type ThreadStatusRecord,
} from "@/lib/thread-status-store";

export function ThreadStatusToasts() {
  const aui = useAui();
  const prevRef = useRef<Map<string, ThreadStatusRecord>>(
    new Map(useThreadStatusStore.getState().statuses),
  );

  useEffect(() => {
    return useThreadStatusStore.subscribe((state) => {
      const { statuses, currentThreadId } = state;
      const prev = prevRef.current;

      for (const [threadId, record] of statuses) {
        const prevRecord = prev.get(threadId);
        if (!prevRecord) continue;
        if (threadId === currentThreadId) continue;

        const label = record.title ?? "A thread";

        if (prevRecord.status === "running" && record.status === "idle") {
          toast(`${label} finished`, {
            duration: 4000,
            action: {
              label: "View",
              onClick: () => aui.threads().switchToThread(threadId),
            },
          });
        } else if (prevRecord.status === "running" && record.status === "error") {
          toast.error(`${label} errored`, {
            action: {
              label: "View",
              onClick: () => aui.threads().switchToThread(threadId),
            },
          });
        } else if (
          prevRecord.status !== "waiting-approval" &&
          record.status === "waiting-approval"
        ) {
          toast.warning(`${label} needs your approval`, {
            action: {
              label: "Go",
              onClick: () => aui.threads().switchToThread(threadId),
            },
          });
        }
      }

      prevRef.current = new Map(statuses);
    });
  }, [aui]);

  return null;
}
