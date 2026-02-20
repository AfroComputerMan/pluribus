import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { useCodexApprovalStore } from "@/lib/codex-approval-store";
import { cn } from "@/lib/utils";

async function respondToApproval(approvalId: string, allow: boolean) {
  await invoke("codex_approve_tool", { approvalId, allow });
  useCodexApprovalStore.getState().dismiss(approvalId);
}

export function ApprovalBanner() {
  const pending = useCodexApprovalStore((s) => s.pending[0]);
  if (!pending) return null;

  return (
    <div
      className={cn(
        "fixed bottom-4 left-1/2 z-50 -translate-x-1/2",
        "flex items-center gap-3 rounded-lg border border-border bg-background/95 px-4 py-3 shadow-lg backdrop-blur",
        "max-w-lg",
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Codex wants to run:</p>
        <code className="mt-0.5 block truncate text-xs text-muted-foreground">
          {pending.command}
        </code>
        {pending.reason && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {pending.reason}
          </p>
        )}
      </div>
      <div className="flex shrink-0 gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => respondToApproval(pending.approval_id, false)}
        >
          Deny
        </Button>
        <Button
          size="sm"
          onClick={() => respondToApproval(pending.approval_id, true)}
        >
          Allow
        </Button>
      </div>
    </div>
  );
}
