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

type PendingThreadOptions = {
  cwd?: string | null;
  workspaceId?: string | null;
  gitBranch?: string | null;
  model?: string | null;
  effort?: string | null;
};

const pendingThreadOptionsById = new Map<string, PendingThreadOptions>();

// --- Title generation (concurrent with main run) ---

/** IDs that already received an AI-generated title via the event channel. */
const titleAlreadySetForIds = new Set<string>();

type TitleReadyCallback = (remoteId: string, title: string) => void;
const titleReadyCallbacks = new Set<TitleReadyCallback>();

/** Subscribe to title-ready events. Returns unsubscribe function. */
export function onTitleReady(cb: TitleReadyCallback): () => void {
  titleReadyCallbacks.add(cb);
  return () => { titleReadyCallbacks.delete(cb); };
}

/**
 * Fire-and-forget: start generating a title concurrently with the main run.
 * When the CLI returns, persists to SQLite and notifies subscribers so the
 * Provider can call `aui.threadListItem().rename()` mid-stream.
 */
export function prefetchTitle(remoteId: string, userText: string): void {
  if (titleAlreadySetForIds.has(remoteId)) return;

  const snippet = userText.slice(0, 500);
  const prompt = `Generate a concise 3-4 word title for a conversation starting with this message. Return ONLY the title, no quotes or extra punctuation.\n\nMessage: ${snippet}`;

  Command.create("claude", [
    "-p",
    prompt,
    "--model",
    "claude-haiku-4-5-20251001",
    "--output-format",
    "text",
  ])
    .execute()
    .then(async (result) => {
      if (result.code === 0 && result.stdout.trim()) {
        const generated = result.stdout.trim();
        if (generated.length >= 1 && generated.length <= 60) {
          await db.threads.rename(remoteId, generated);
          titleAlreadySetForIds.add(remoteId);
          for (const cb of titleReadyCallbacks) cb(remoteId, generated);
        }
      }
    })
    .catch(() => { /* CLI unavailable — generateTitle() will use fallback */ });
}

export function getPendingThreadOptions(
  threadId: string,
): PendingThreadOptions | undefined {
  return pendingThreadOptionsById.get(threadId);
}

export function setPendingThreadOptions(
  threadId: string,
  options: PendingThreadOptions,
): void {
  const normalizedCwd = options.cwd?.trim() || null;
  const normalizedWorkspaceId = options.workspaceId?.trim() || null;
  const normalizedGitBranch = options.gitBranch?.trim() || null;
  const normalizedModel = options.model?.trim() || null;
  const normalizedEffort = options.effort?.trim() || null;
  if (!normalizedCwd && !normalizedWorkspaceId && !normalizedGitBranch && !normalizedModel && !normalizedEffort) {
    pendingThreadOptionsById.delete(threadId);
    return;
  }
  pendingThreadOptionsById.set(threadId, {
    cwd: normalizedCwd,
    workspaceId: normalizedWorkspaceId,
    gitBranch: normalizedGitBranch,
    model: normalizedModel,
    effort: normalizedEffort,
  });
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
      const pending = pendingThreadOptionsById.get(threadId);
      const row = await db.threads.create(threadId, pending);
      pendingThreadOptionsById.delete(threadId);
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
      // If the event channel already pushed an AI title mid-stream, just
      // echo back whatever is persisted — no need to spawn Haiku again.
      if (titleAlreadySetForIds.has(remoteId)) {
        const row = await db.threads.get(remoteId);
        const existing = row?.title ?? "New Thread";
        return createAssistantStream((controller) => {
          controller.appendText(existing);
        });
      }

      // Fallback: prefetch wasn't triggered or CLI failed silently.
      const firstUserMsg = messages.find((m) => m.role === "user");
      const text =
        firstUserMsg?.content
          .filter((c): c is { type: "text"; text: string } => c.type === "text")
          .map((c) => c.text)
          .join(" ") ?? "New Thread";

      const title = text.length > 50 ? text.slice(0, 47) + "..." : text;
      await db.threads.rename(remoteId, title);
      return createAssistantStream((controller) => {
        controller.appendText(title);
      });
    },

    unstable_Provider: SQLiteHistoryProvider,
  };
}
