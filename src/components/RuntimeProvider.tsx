import type { ReactNode } from "react";
import { useMemo } from "react";
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  unstable_useRemoteThreadListRuntime as useRemoteThreadListRuntime,
} from "@assistant-ui/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createClaudeAdapter } from "@/lib/claude-adapter";
import { createSQLiteThreadListAdapter } from "@/lib/sqlite-thread-list-adapter";

const threadListAdapter = createSQLiteThreadListAdapter();

/** Inner hook — creates the per-thread local runtime with the Claude adapter. */
function useRuntimeHook() {
  const adapter = useMemo(() => createClaudeAdapter(), []);
  return useLocalRuntime(adapter);
}

/**
 * Provides the assistant-ui runtime context with SQLite-backed
 * thread list persistence and per-thread message history.
 */
export function RuntimeProvider({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const runtime = useRemoteThreadListRuntime({
    runtimeHook: useRuntimeHook,
    adapter: threadListAdapter,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <TooltipProvider>{children}</TooltipProvider>
    </AssistantRuntimeProvider>
  );
}
