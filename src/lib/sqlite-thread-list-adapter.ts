import type {
  unstable_RemoteThreadListAdapter as RemoteThreadListAdapter,
  ThreadMessage,
} from "@assistant-ui/react";
import { createAssistantStream } from "assistant-stream";
import { Command } from "@tauri-apps/plugin-shell";
import { db, type ThreadRow } from "@/lib/db";
import { SQLiteHistoryProvider } from "@/lib/sqlite-thread-history-adapter";

type RemoteThreadMetadata = {
  remoteId: string;
  status: "regular" | "archived";
  title?: string;
  externalId?: string;
};

const pendingThreadCwdById = new Map<string, string>();

export function setPendingThreadCwd(threadId: string, cwd: string): void {
  const normalized = cwd.trim();
  if (!normalized) {
    pendingThreadCwdById.delete(threadId);
    return;
  }
  pendingThreadCwdById.set(threadId, normalized);
}

function threadRowToMetadata(row: ThreadRow): RemoteThreadMetadata {
  return {
    remoteId: row.remote_id,
    status: row.status,
    title: row.title ?? undefined,
    externalId: row.id,
  };
}

export function createSQLiteThreadListAdapter(): RemoteThreadListAdapter {
  return {
    async list() {
      const rows = await db.threads.list();
      return { threads: rows.map(threadRowToMetadata) };
    },

    async initialize(threadId: string) {
      const pendingCwd = pendingThreadCwdById.get(threadId);
      const row = await db.threads.create(threadId, pendingCwd);
      pendingThreadCwdById.delete(threadId);
      return { remoteId: row.remote_id, externalId: row.id };
    },

    async rename(remoteId: string, newTitle: string) {
      await db.threads.rename(remoteId, newTitle);
    },

    async archive(remoteId: string) {
      await db.threads.archive(remoteId);
    },

    async unarchive(remoteId: string) {
      await db.threads.unarchive(remoteId);
    },

    async delete(remoteId: string) {
      await db.threads.delete(remoteId);
    },

    async fetch(threadId: string) {
      const row = await db.threads.get(threadId);
      if (!row) throw new Error(`Thread not found: ${threadId}`);
      return threadRowToMetadata(row);
    },

    async generateTitle(remoteId: string, messages: readonly ThreadMessage[]) {
      const firstUserMsg = messages.find((m) => m.role === "user");
      const text =
        firstUserMsg?.content
          .filter((c): c is { type: "text"; text: string } => c.type === "text")
          .map((c) => c.text)
          .join(" ") ?? "New Thread";

      const fallback = text.length > 50 ? text.slice(0, 47) + "..." : text;

      return createAssistantStream(async (controller) => {
        let title = fallback;
        try {
          const snippet = text.slice(0, 500);
          const prompt = `Generate a short, descriptive title (max 8 words) for a conversation that starts with this message. Return ONLY the title text, no quotes or punctuation around it.\n\nMessage: ${snippet}`;
          const result = await Command.create("claude", [
            "-p",
            prompt,
            "--model",
            "claude-haiku-4-5-20251001",
            "--output-format",
            "text",
          ]).execute();

          if (result.code === 0 && result.stdout.trim()) {
            const generated = result.stdout.trim();
            if (generated.length >= 1 && generated.length <= 80) {
              title = generated;
            }
          }
        } catch {
          // CLI unavailable or failed — use fallback silently
        }

        await db.threads.rename(remoteId, title);
        controller.appendText(title);
      });
    },

    unstable_Provider: SQLiteHistoryProvider,
  };
}
