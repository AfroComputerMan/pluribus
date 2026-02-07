import { create } from 'zustand';

interface SettingsState {
  model: 'sonnet' | 'opus' | 'haiku';
  autonomyLevel: 'ask' | 'supervised' | 'autonomous';
  theme: 'light' | 'dark' | 'system';
  editorCommand: string;
  worktreeAutoCleanup: boolean;
  claudeCliPath: string | null;

  updateSetting: <K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) => void;
  resetToDefaults: () => void;
}

type SettingsValues = Pick<
  SettingsState,
  'model' | 'autonomyLevel' | 'theme' | 'editorCommand' | 'worktreeAutoCleanup' | 'claudeCliPath'
>;

const defaults: SettingsValues = {
  model: 'sonnet',
  autonomyLevel: 'supervised',
  theme: 'system',
  editorCommand: 'code',
  worktreeAutoCleanup: true,
  claudeCliPath: null,
};

export const useSettingsStore = create<SettingsState>((set) => ({
  ...defaults,

  updateSetting: (key, value) =>
    set({ [key]: value }),

  resetToDefaults: () =>
    set(defaults),
}));
