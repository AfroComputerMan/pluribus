import type { ReactNode } from "react";
import { useMemo } from "react";
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  unstable_useRemoteThreadListRuntime as useRemoteThreadListRuntime,
} from "@assistant-ui/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createRouterAdapter } from "@/lib/router-adapter";
import { createSQLiteThreadListAdapter } from "@/lib/sqlite-thread-list-adapter";
import { ApprovalBanner } from "@/components/assistant-ui/approval-banner";

const threadListAdapter = createSQLiteThreadListAdapter();

/** Inner hook — creates the per-thread local runtime with the router adapter. */
function useRuntimeHook() {
  return useLocalRuntime(useMemo(() => createRouterAdapter(), []));
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
      <ApprovalBanner />
    </AssistantRuntimeProvider>
  );
}
