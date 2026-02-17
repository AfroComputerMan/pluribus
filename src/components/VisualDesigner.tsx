import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  getVisualLayout,
  VISUAL_LAYOUTS,
  type VisualLayoutId,
} from "@/lib/visual-layouts";
import {
  ChevronsLeftRightEllipsisIcon,
  LayoutGridIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { type FC, useMemo, useState } from "react";

type VisualDesignerProps = {
  activeLayoutId: VisualLayoutId;
  onLayoutChange: (layoutId: VisualLayoutId) => void;
};

export const VisualDesigner: FC<VisualDesignerProps> = ({ activeLayoutId, onLayoutChange }) => {
  const [open, setOpen] = useState(true);
  const activeLayout = useMemo(() => getVisualLayout(activeLayoutId), [activeLayoutId]);

  return (
    <div className="visual-designer fixed top-3 right-3 z-50 flex max-w-[min(92vw,27rem)] flex-col items-end gap-2">
      {open ? (
        <div className="visual-designer-panel w-full rounded-3xl border border-border/70 bg-card/92 p-3 shadow-2xl backdrop-blur-xl">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <p className="flex items-center gap-2 font-semibold text-sm uppercase tracking-[0.18em] text-muted-foreground">
                <SparklesIcon className="size-3.5" />
                Visual Designer
              </p>
              <h2 className="mt-1 font-semibold text-lg">Choose a complete app layout</h2>
              <p className="text-muted-foreground text-xs">Five directions. Different structure, motion, and interaction flow.</p>
            </div>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              className="rounded-full"
              onClick={() => setOpen(false)}
              aria-label="Close visual designer"
            >
              <XIcon />
            </Button>
          </div>

          <div className="grid max-h-[52vh] gap-2 overflow-y-auto pr-1">
            {VISUAL_LAYOUTS.map((layout) => {
              const isActive = layout.id === activeLayoutId;
              return (
                <button
                  key={layout.id}
                  type="button"
                  className={cn(
                    "visual-layout-choice group relative overflow-hidden rounded-2xl border px-3 py-3 text-left transition-all duration-200",
                    "hover:-translate-y-0.5 hover:shadow-lg",
                    isActive
                      ? "border-primary/60 bg-primary/10"
                      : "border-border/70 bg-background/55 hover:border-primary/35",
                  )}
                  onClick={() => onLayoutChange(layout.id)}
                  data-layout-id={layout.id}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold text-sm">{layout.name}</p>
                      <p className="text-muted-foreground text-xs">{layout.vibe}</p>
                    </div>
                    <span
                      aria-hidden
                      className="inline-flex size-4 rounded-full border border-white/40"
                      style={{ backgroundColor: layout.accent }}
                    />
                  </div>

                  <div className="visual-layout-preview mb-2 h-12 w-full rounded-xl border border-border/60 bg-card/75 p-1.5">
                    <div className="visual-layout-preview-grid grid h-full w-full gap-1 rounded-lg">
                      <span className="visual-layout-block rounded-[0.4rem] bg-muted/70" />
                      <span className="visual-layout-block rounded-[0.4rem] bg-muted/45" />
                      <span className="visual-layout-block rounded-[0.4rem] bg-muted/25" />
                    </div>
                  </div>

                  <p className="line-clamp-2 text-muted-foreground text-xs">{layout.description}</p>
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-between rounded-xl border border-border/70 bg-background/60 px-3 py-2">
            <div>
              <p className="font-medium text-sm">Active: {activeLayout.name}</p>
              <p className="text-muted-foreground text-xs">{activeLayout.vibe}</p>
            </div>
            <Button type="button" size="sm" className="rounded-full px-4" onClick={() => setOpen(false)}>
              <ChevronsLeftRightEllipsisIcon className="size-4" />
              Hide Panel
            </Button>
          </div>
        </div>
      ) : null}

      <Button
        type="button"
        variant="secondary"
        className="rounded-full border border-border/70 bg-card/92 shadow-lg"
        onClick={() => setOpen((current) => !current)}
        aria-label="Open visual designer"
      >
        <LayoutGridIcon className="size-4" />
        Layout Lab
      </Button>
    </div>
  );
};
