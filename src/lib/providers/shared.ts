import type { ChatModelRunOptions } from "@assistant-ui/react";

type Message = ChatModelRunOptions["messages"][number];

// ---------------------------------------------------------------------------
// extractUserPrompt
// ---------------------------------------------------------------------------

/**
 * Extract the text content from the last user message.
 *
 * Finds the last message with role "user" and concatenates all text parts.
 * Returns an empty string if no user message is found.
 */
export function extractUserPrompt(
  messages: readonly Message[],
): string {
  // Walk backwards to find the last user message
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "user") continue;

    const textParts: string[] = [];
    for (const part of msg.content) {
      if (part.type === "text") {
        textParts.push(part.text);
      }
    }
    return textParts.join("\n");
  }

  return "";
}

// ---------------------------------------------------------------------------
// Dev-only logger
// ---------------------------------------------------------------------------

/**
 * Log messages only in development mode.
 */
export function log(prefix: string, ...args: unknown[]): void {
  if (import.meta.env.DEV) {
    console.log(`[${prefix}]`, ...args);
  }
}
