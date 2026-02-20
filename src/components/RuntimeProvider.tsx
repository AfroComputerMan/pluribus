import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  unstable_useRemoteThreadListRuntime as useRemoteThreadListRuntime,
} from "@assistant-ui/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createAgentSdkAdapter } from "@/lib/agent-sdk-adapter";
import { createClaudeAdapter } from "@/lib/claude-adapter";
import { db } from "@/lib/db";
import { createSQLiteThreadListAdapter } from "@/lib/sqlite-thread-list-adapter";

export type AdapterType = "shell" | "agent-sdk";

const threadListAdapter = createSQLiteThreadListAdapter();

/** Read the persisted adapter type from SQLite once on mount. */
function useAdapterType(): AdapterType {
  const [adapterType, setAdapterType] = useState<AdapterType>("shell");

  useEffect(() => {
    db.globalSettings
      .get("adapter_type")
      .then((value) => {
        if (value === "agent-sdk") setAdapterType("agent-sdk");
      })
      .catch((err) => {
        console.warn(
          "[RuntimeProvider] failed to read adapter_type setting:",
          err,
        );
      });
  }, []);

  return adapterType;
}

/** Inner hook — creates the per-thread local runtime with the appropriate adapter. */
function useRuntimeHook() {
  const adapterType = useAdapterType();
  const adapter = useMemo(
    () =>
      adapterType === "agent-sdk"
        ? createAgentSdkAdapter()
        : createClaudeAdapter(),
    [adapterType],
  );
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
