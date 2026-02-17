export type ThemeId = "studio" | "graphite" | "sunset" | "terminal" | "paper";

export type AppTheme = {
  id: ThemeId;
  name: string;
  description: string;
  isDark: boolean;
};

export const APP_THEMES: AppTheme[] = [
  {
    id: "studio",
    name: "Studio",
    description: "Clean and modern with soft depth.",
    isDark: false,
  },
  {
    id: "graphite",
    name: "Graphite",
    description: "Dark, focused workspace for long sessions.",
    isDark: true,
  },
  {
    id: "sunset",
    name: "Sunset",
    description: "Warm contrast with expressive accents.",
    isDark: false,
  },
  {
    id: "terminal",
    name: "Terminal",
    description: "High-contrast retro console aesthetic.",
    isDark: true,
  },
  {
    id: "paper",
    name: "Paper",
    description: "Editorial layout with sharp borders.",
    isDark: false,
  },
];

export const DEFAULT_THEME_ID: ThemeId = "studio";

export const THEME_STORAGE_KEY = "pluribus-theme-id";

export const isThemeId = (value: string): value is ThemeId => {
  return APP_THEMES.some((theme) => theme.id === value);
};
