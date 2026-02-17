export type ThemeId = "carbon";

export type AppTheme = {
  id: ThemeId;
  name: string;
  description: string;
  isDark: boolean;
};

export const APP_THEMES: AppTheme[] = [
  {
    id: "carbon",
    name: "Carbon",
    description: "Warm dark IDE interface with amber and teal accents.",
    isDark: true,
  },
];

export const DEFAULT_THEME_ID: ThemeId = "carbon";

export const THEME_STORAGE_KEY = "pluribus-theme-id";

export const isThemeId = (value: string): value is ThemeId => {
  return APP_THEMES.some((theme) => theme.id === value);
};
