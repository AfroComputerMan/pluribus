import { Thread } from "@/components/assistant-ui/thread";
import { ThreadList } from "@/components/assistant-ui/thread-list";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useMediaQuery } from "@/hooks/use-media-query";
import { NARROW_BREAKPOINT } from "@/lib/breakpoints";
import { cn } from "@/lib/utils";
import {
  MenuIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

export function ThreadWorkspace() {
  const [isNavOpen, setIsNavOpen] = useState(true);
  const [isUtilityOpen, setIsUtilityOpen] = useState(true);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const isNarrow = useMediaQuery(NARROW_BREAKPOINT);

  useEffect(() => {
    if (!isNarrow) setIsDrawerOpen(false);
  }, [isNarrow]);

  const shellClassName = "app-shell h-full w-full";

  if (isNarrow) {
    return (
      <div className={shellClassName}>
        <div className="workspace-grid workspace-narrow">
          <section className="workspace-thread">
            <Button
              variant="ghost"
              size="icon-xs"
              className="workspace-panel-toggle absolute top-2 left-2 z-20"
              onClick={() => setIsDrawerOpen(true)}
              aria-label="Open sidebar"
            >
              <MenuIcon className="size-4" />
            </Button>
            <Thread />
          </section>
        </div>

        <Sheet open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
          <SheetContent
            side="left"
            className="workspace-drawer-sheet flex flex-col p-0 w-[280px]"
          >
            <SheetHeader className="sr-only">
              <SheetTitle>Navigation</SheetTitle>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-hidden">
              <ThreadList />
            </div>
            <div className="workspace-drawer-notes border-t border-border">
              <p className="workspace-utility-label px-3 pt-3 pb-1">Notes</p>
              <textarea
                className="workspace-utility-notes mx-3 mb-3"
                style={{ minHeight: "8rem", width: "calc(100% - 1.5rem)" }}
                placeholder="Capture scratch notes, commands, and reminders..."
              />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    );
  }

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
