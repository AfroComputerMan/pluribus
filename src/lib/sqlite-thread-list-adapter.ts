import type {
  unstable_RemoteThreadListAdapter as RemoteThreadListAdapter,
  ThreadMessage,
} from "@assistant-ui/react";
import { createAssistantStream } from "assistant-stream";
import { db, type ThreadRow } from "@/lib/db";
import { SQLiteHistoryProvider } from "@/lib/sqlite-thread-history-adapter";

type RemoteThreadMetadata = {
  remoteId: string;
  status: "regular" | "archived";
  title?: string;
  externalId?: string;
};

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
      const row = await db.threads.create(threadId);
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

      const title = text.length > 50 ? text.slice(0, 47) + "..." : text;

      // Persist to SQLite (assistant-ui does NOT call rename() after generateTitle)
      await db.threads.rename(remoteId, title);

      return createAssistantStream((controller) => {
        controller.appendText(title);
      });
    },

    unstable_Provider: SQLiteHistoryProvider,
  };
}
