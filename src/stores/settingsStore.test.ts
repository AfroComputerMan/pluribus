import { describe, it, expect, beforeEach } from 'vitest';
import { useSettingsStore } from './settingsStore';

const initialState = () => useSettingsStore.getState();

describe('settingsStore', () => {
  beforeEach(() => {
    // Reset to defaults between tests
    useSettingsStore.getState().resetToDefaults();
  });

  describe('default values', () => {
    it('has sonnet as default model', () => {
      expect(initialState().model).toBe('sonnet');
    });

    it('has supervised as default autonomy level', () => {
      expect(initialState().autonomyLevel).toBe('supervised');
    });

    it('has system as default theme', () => {
      expect(initialState().theme).toBe('system');
    });

    it('has code as default editor command', () => {
      expect(initialState().editorCommand).toBe('code');
    });

    it('has worktreeAutoCleanup enabled by default', () => {
      expect(initialState().worktreeAutoCleanup).toBe(true);
    });

    it('has null claudeCliPath by default', () => {
      expect(initialState().claudeCliPath).toBeNull();
    });
  });

  describe('updateSetting', () => {
    it('updates model', () => {
      useSettingsStore.getState().updateSetting('model', 'opus');
      expect(initialState().model).toBe('opus');
    });

    it('updates autonomyLevel', () => {
      useSettingsStore.getState().updateSetting('autonomyLevel', 'autonomous');
      expect(initialState().autonomyLevel).toBe('autonomous');
    });

    it('updates theme', () => {
      useSettingsStore.getState().updateSetting('theme', 'dark');
      expect(initialState().theme).toBe('dark');
    });

    it('updates editorCommand', () => {
      useSettingsStore.getState().updateSetting('editorCommand', 'vim');
      expect(initialState().editorCommand).toBe('vim');
    });

    it('updates worktreeAutoCleanup', () => {
      useSettingsStore.getState().updateSetting('worktreeAutoCleanup', false);
      expect(initialState().worktreeAutoCleanup).toBe(false);
    });

    it('updates claudeCliPath', () => {
      useSettingsStore.getState().updateSetting('claudeCliPath', '/usr/local/bin/claude');
      expect(initialState().claudeCliPath).toBe('/usr/local/bin/claude');
    });

    it('does not affect other settings when updating one', () => {
      useSettingsStore.getState().updateSetting('model', 'haiku');
      const state = initialState();
      expect(state.model).toBe('haiku');
      expect(state.autonomyLevel).toBe('supervised');
      expect(state.theme).toBe('system');
      expect(state.editorCommand).toBe('code');
      expect(state.worktreeAutoCleanup).toBe(true);
      expect(state.claudeCliPath).toBeNull();
    });
  });

  describe('resetToDefaults', () => {
    it('resets all settings after modifications', () => {
      const store = useSettingsStore.getState();
      store.updateSetting('model', 'opus');
      store.updateSetting('autonomyLevel', 'autonomous');
      store.updateSetting('theme', 'dark');
      store.updateSetting('editorCommand', 'nvim');
      store.updateSetting('worktreeAutoCleanup', false);
      store.updateSetting('claudeCliPath', '/bin/claude');

      useSettingsStore.getState().resetToDefaults();

      const state = initialState();
      expect(state.model).toBe('sonnet');
      expect(state.autonomyLevel).toBe('supervised');
      expect(state.theme).toBe('system');
      expect(state.editorCommand).toBe('code');
      expect(state.worktreeAutoCleanup).toBe(true);
      expect(state.claudeCliPath).toBeNull();
    });
  });
});
