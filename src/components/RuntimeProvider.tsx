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
import { createCodexAdapter } from "@/lib/codex-adapter";
import { db } from "@/lib/db";
import { createSQLiteThreadListAdapter } from "@/lib/sqlite-thread-list-adapter";
import { ApprovalBanner } from "@/components/assistant-ui/approval-banner";

export type AdapterType = "shell" | "agent-sdk" | "codex";

const threadListAdapter = createSQLiteThreadListAdapter();

/** Read the persisted adapter type from SQLite once on mount. */
function useAdapterType(): AdapterType {
  const [adapterType, setAdapterType] = useState<AdapterType>("shell");

  useEffect(() => {
    db.globalSettings
      .get("adapter_type")
      .then((value) => {
        if (value === "agent-sdk") setAdapterType("agent-sdk");
        else if (value === "codex") setAdapterType("codex");
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
  const adapter = useMemo(() => {
    switch (adapterType) {
      case "agent-sdk":
        return createAgentSdkAdapter();
      case "codex":
        return createCodexAdapter();
      default:
        return createClaudeAdapter();
    }
  }, [adapterType]);
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
      <ApprovalBanner />
    </AssistantRuntimeProvider>
  );
}
