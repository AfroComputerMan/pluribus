import { AppShell } from '@/components/layout/AppShell';

export function SettingsPage() {
  return (
    <AppShell>
      <div className="flex-1 flex items-center justify-center h-full">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
            Settings
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Settings page coming soon.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
