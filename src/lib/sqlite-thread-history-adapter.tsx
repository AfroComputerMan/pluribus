import { useMemo } from "react";
import {
  RuntimeAdapterProvider,
  useAui,
  type ThreadMessage,
  type ExportedMessageRepositoryItem,
  type ThreadHistoryAdapter,
} from "@assistant-ui/react";
import { db, type MessageRow } from "@/lib/db";

/** Serialize a ThreadMessage into a MessageRow for SQLite storage. */
function messageToRow(
  threadId: string,
  item: ExportedMessageRepositoryItem,
): MessageRow {
  const msg = item.message;
  return {
    id: msg.id,
    thread_id: threadId,
    parent_id: item.parentId,
    role: msg.role,
    content: JSON.stringify(msg.content),
    status: "status" in msg ? JSON.stringify(msg.status) : null,
    metadata: JSON.stringify(msg.metadata ?? { custom: {} }),
    run_config: item.runConfig ? JSON.stringify(item.runConfig) : null,
    created_at: msg.createdAt
      ? new Date(msg.createdAt).toISOString()
      : new Date().toISOString(),
  };
}

/** Deserialize a MessageRow back into an ExportedMessageRepositoryItem. */
function rowToMessageItem(row: MessageRow): ExportedMessageRepositoryItem {
  return {
    parentId: row.parent_id,
    message: {
      id: row.id,
      createdAt: new Date(row.created_at),
      role: row.role,
      content: JSON.parse(row.content),
      ...("status" in row && row.status
        ? { status: JSON.parse(row.status) }
        : {}),
      metadata: row.metadata ? JSON.parse(row.metadata) : { custom: {} },
      ...(row.role === "user" ? { attachments: [] } : {}),
    } as ThreadMessage,
    ...(row.run_config ? { runConfig: JSON.parse(row.run_config) } : {}),
  };
}

/**
 * React component set on `RemoteThreadListAdapter.unstable_Provider`.
 * Injects a per-thread `ThreadHistoryAdapter` via `RuntimeAdapterProvider`.
 */
export function SQLiteHistoryProvider({
  children,
}: {
  children?: React.ReactNode;
}) {
  const aui = useAui();

  const history = useMemo<ThreadHistoryAdapter>(
    () => ({
      async load() {
        const threadListItem = aui.threadListItem();
        const state = threadListItem.getState();
        const threadId = state.remoteId;
        if (!threadId) return { messages: [] };

        const rows = await db.messages.loadByThread(threadId);
        const messages = rows.map(rowToMessageItem);

        const headId =
          messages.length > 0
            ? messages[messages.length - 1]!.message.id
            : null;

        return { headId, messages };
      },

      async append(item) {
        const threadListItem = aui.threadListItem();
        const { remoteId } = await threadListItem.initialize();
        const row = messageToRow(remoteId, item);
        await db.messages.append(row);
      },
    }),
    [aui],
  );

  return (
    <RuntimeAdapterProvider adapters={{ history }}>
      {children}
    </RuntimeAdapterProvider>
  );
}
