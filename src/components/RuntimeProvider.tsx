import type { ReactNode } from "react";
import { useEffect, useMemo, useRef } from "react";
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
} from "@assistant-ui/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createClaudeAdapter } from "@/lib/claude-adapter";

/**
 * Provides the assistant-ui runtime context, connecting
 * LocalRuntime to the Claude CLI adapter.
 *
 * Wrap your app (or the subtree that needs chat) in this provider.
 * All assistant-ui primitives (Thread, Composer, etc.) will
 * automatically consume the runtime from context.
 */
export function RuntimeProvider({
  children,
  threadKey,
  onUserPrompt,
}: Readonly<{
  children: ReactNode;
  threadKey?: string;
  onUserPrompt?: (prompt: string) => void;
}>) {
  const onUserPromptRef = useRef(onUserPrompt);
  useEffect(() => {
    onUserPromptRef.current = onUserPrompt;
  }, [onUserPrompt]);

  const adapter = useMemo(
    () =>
      createClaudeAdapter({
        threadKey,
        onUserPrompt: (prompt) => onUserPromptRef.current?.(prompt),
      }),
    [threadKey],
  );
  const runtime = useLocalRuntime(adapter);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <TooltipProvider>
        {children}
      </TooltipProvider>
    </AssistantRuntimeProvider>
  );
}
