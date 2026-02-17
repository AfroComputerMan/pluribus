import { type FC } from "react";
import type { ThemeId } from "@/lib/themes";

type ThemeSwitcherProps = {
  activeThemeId: ThemeId;
  onThemeChange: (themeId: ThemeId) => void;
};

export const ThemeSwitcher: FC<ThemeSwitcherProps> = ({ activeThemeId, onThemeChange }) => {
  void activeThemeId;
  void onThemeChange;
  return null;
};
