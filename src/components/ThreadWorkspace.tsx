import { Thread } from "@/components/assistant-ui/thread";
import { ThreadList } from "@/components/assistant-ui/thread-list";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PanelLeftCloseIcon, PanelLeftOpenIcon, PanelRightCloseIcon, PanelRightOpenIcon } from "lucide-react";
import { useState } from "react";

export function ThreadWorkspace() {
  const [isNavOpen, setIsNavOpen] = useState(true);
  const [isUtilityOpen, setIsUtilityOpen] = useState(true);

  const shellClassName = "app-shell h-full w-full";

  return (
    <div className={shellClassName}>
      <div
        className={cn(
          "workspace-grid",
          !isNavOpen && "nav-collapsed",
          !isUtilityOpen && "utility-collapsed",
        )}
      >
        <aside className={cn("workspace-nav", !isNavOpen && "collapsed")}>
          <div className="workspace-nav-header">
            <Button
              variant="ghost"
              size="icon-xs"
              className="workspace-panel-toggle"
              onClick={() => setIsNavOpen(false)}
              aria-label="Collapse sidebar"
            >
              <PanelLeftCloseIcon className="size-4" />
            </Button>
          </div>
          <div className="workspace-nav-content">
            <ThreadList />
          </div>
        </aside>
        <section className="workspace-thread">
          {!isNavOpen ? (
            <Button
              variant="ghost"
              size="icon-xs"
              className="workspace-panel-toggle absolute top-2 left-2 z-20"
              onClick={() => setIsNavOpen(true)}
              aria-label="Expand sidebar"
            >
              <PanelLeftOpenIcon className="size-4" />
            </Button>
          ) : null}
          {!isUtilityOpen ? (
            <Button
              variant="ghost"
              size="icon-xs"
              className="workspace-panel-toggle absolute top-2 right-2 z-20"
              onClick={() => setIsUtilityOpen(true)}
              aria-label="Expand notes panel"
            >
              <PanelRightOpenIcon className="size-4" />
            </Button>
          ) : null}
          <Thread />
        </section>
        <aside className={cn("workspace-utility", !isUtilityOpen && "collapsed")}>
          <div className="workspace-utility-header">
            <Button
              variant="ghost"
              size="icon-xs"
              className="workspace-panel-toggle"
              onClick={() => setIsUtilityOpen(false)}
              aria-label="Collapse notes panel"
            >
              <PanelRightCloseIcon className="size-4" />
            </Button>
          </div>
          <div className="workspace-utility-content">
            <div className="workspace-utility-body">
              <p className="workspace-utility-label">Notes</p>
              <textarea
                className="workspace-utility-notes"
                placeholder="Capture scratch notes, commands, and reminders..."
              />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
