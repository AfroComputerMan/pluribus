/**
 * ExitGuard -- prevents window close when agents are running.
 *
 * Listens for the Tauri close-requested event and shows a native confirm dialog
 * if there are active tracked processes. On confirm, kills all processes and
 * allows the close.
 */
import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { processManager } from "@/components/RuntimeProvider";

export function ExitGuard() {
  useEffect(() => {
    const unlisten = getCurrentWindow().onCloseRequested(async (event) => {
      const hasActive = await processManager.hasActiveProcesses();
      if (!hasActive) return; // Allow close immediately

      // Prevent the close until user confirms
      event.preventDefault();

      const agents = await processManager.getActiveAgentDescriptions();
      const agentList = agents
        .map((a) => a.title ?? a.threadId)
        .join(", ");
      const count = agents.length;
      const message =
        count === 1
          ? `1 agent is still running (${agentList}). Close anyway?`
          : `${count} agents are still running (${agentList}). Close anyway?`;

      // Use browser confirm as a simple cross-platform solution
      const confirmed = window.confirm(message);

      if (confirmed) {
        await processManager.killAll();
        // Close the window after cleanup
        await getCurrentWindow().close();
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return null;
}
