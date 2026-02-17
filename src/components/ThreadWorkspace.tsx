import { Thread } from "@/components/assistant-ui/thread";
import { ThreadList } from "@/components/assistant-ui/thread-list";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PanelLeftOpenIcon, PanelRightOpenIcon } from "lucide-react";
import { useState } from "react";

export function ThreadWorkspace() {
  const [isNavOpen, setIsNavOpen] = useState(true);
  const [isUtilityOpen, setIsUtilityOpen] = useState(true);

  const shellClassName = "app-shell layout-atelier h-full w-full";

  return (
    <div className={shellClassName}>
      <div className="workspace-grid">
        <aside className={cn("workspace-nav", !isNavOpen && "hidden")}>
          <ThreadList />
        </aside>
        <section className="workspace-thread">
          <Thread />
        </section>
        <aside className={cn("workspace-utility", !isUtilityOpen && "hidden")}>
          <p className="workspace-utility-label">Scratchpad</p>
          <p className="workspace-utility-copy">
            Keep temporary ideas and command notes near your active thread.
          </p>
        </aside>
      </div>
      <div className="workspace-fab-row">
        <Button variant="secondary" size="sm" onClick={() => setIsNavOpen((v) => !v)}>
          <PanelLeftOpenIcon className="size-4" />
          Toggle Workspace List
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setIsUtilityOpen((v) => !v)}>
          <PanelRightOpenIcon className="size-4" />
          Toggle Scratchpad
        </Button>
      </div>
    </div>
  );
}
