import { Button } from "@/components/ui/button";
import { APP_THEMES, type ThemeId } from "@/lib/themes";
import { MonitorCogIcon, PaintbrushVerticalIcon, XIcon } from "lucide-react";
import { type FC, useState } from "react";

type ThemeSwitcherProps = {
  activeThemeId: ThemeId;
  onThemeChange: (themeId: ThemeId) => void;
};

export const ThemeSwitcher: FC<ThemeSwitcherProps> = ({ activeThemeId, onThemeChange }) => {
  const [open, setOpen] = useState(false);

  return (
    <div className="theme-switcher fixed bottom-3 left-3 z-50 flex flex-col items-start gap-2">
      {open ? (
        <div className="theme-switcher-panel w-72 rounded-2xl border border-border/80 bg-card/95 p-3 shadow-xl backdrop-blur">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <PaintbrushVerticalIcon className="size-4" />
              <p className="font-semibold text-sm">Visual Design</p>
            </div>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              className="rounded-full"
              onClick={() => setOpen(false)}
              aria-label="Close theme selector"
            >
              <XIcon />
            </Button>
          </div>

          <div className="space-y-2">
            {APP_THEMES.map((theme) => {
              const isActive = theme.id === activeThemeId;
              return (
                <button
                  key={theme.id}
                  type="button"
                  className="theme-choice flex w-full items-start gap-3 rounded-xl border border-border/80 px-3 py-2 text-left transition-colors hover:bg-accent hover:text-accent-foreground"
                  data-active={isActive}
                  onClick={() => onThemeChange(theme.id)}
                >
                  <span className="mt-0.5 inline-flex size-2.5 shrink-0 rounded-full bg-primary" />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-sm">{theme.name}</span>
                    <span className="block text-muted-foreground text-xs">{theme.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <Button
        type="button"
        variant="secondary"
        className="rounded-full border border-border/70 shadow-lg"
        onClick={() => setOpen((current) => !current)}
        aria-label="Open theme selector"
      >
        <MonitorCogIcon />
        Themes
      </Button>
    </div>
  );
};
