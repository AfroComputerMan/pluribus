import type { ReactNode } from 'react';
import { useSessionStore } from '@/stores/sessionStore';
import { SessionSidebar } from '@/components/session/SessionSidebar';

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const collapsed = useSessionStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useSessionStore((s) => s.toggleSidebar);

  return (
    <div className="flex h-screen bg-white dark:bg-gray-900">
      {/* Sidebar */}
      <div
        className={`shrink-0 border-r border-gray-200 dark:border-gray-700 transition-all duration-200 ${
          collapsed ? 'w-12' : 'w-[280px]'
        }`}
      >
        {collapsed ? (
          <div className="flex flex-col items-center pt-3">
            <button
              type="button"
              onClick={toggleSidebar}
              className="w-8 h-8 flex items-center justify-center rounded text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              aria-label="Expand sidebar"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 4l4 4-4 4" />
              </svg>
            </button>
          </div>
        ) : (
          <div className="flex flex-col h-full">
            <div className="flex-1 overflow-hidden">
              <SessionSidebar />
            </div>
            <div className="border-t border-gray-200 dark:border-gray-700 px-3 py-2">
              <button
                type="button"
                onClick={toggleSidebar}
                className="w-full flex items-center justify-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                aria-label="Collapse sidebar"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 3L4 7l4 4" />
                </svg>
                Collapse
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0 overflow-hidden">
        {children}
      </div>
    </div>
  );
}
