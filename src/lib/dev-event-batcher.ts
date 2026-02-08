import { db, type DevEventRow } from "@/lib/db";

const DEV_EVENT_BATCH_SIZE = 50;
const DEV_EVENT_FLUSH_INTERVAL_MS = 200;

let devEventBatch: DevEventRow[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** Queue a dev event for archival to SQLite. */
export function queueDevEventForArchive(row: DevEventRow): void {
  devEventBatch.push(row);

  if (devEventBatch.length >= DEV_EVENT_BATCH_SIZE) {
    flushDevEventBatch();
  } else if (!flushTimer) {
    flushTimer = setTimeout(flushDevEventBatch, DEV_EVENT_FLUSH_INTERVAL_MS);
  }
}

/** Flush the current batch to SQLite. */
export function flushDevEventBatch(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  if (devEventBatch.length === 0) return;

  const batch = devEventBatch;
  devEventBatch = [];

  // Fire-and-forget — don't block the event stream
  void db.devEvents.insertBatch(batch).catch((err) => {
    console.error("[dev-event-archive] batch insert failed:", err);
  });
}
