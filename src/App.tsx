import "./App.css";
import { lazy, Suspense } from "react";
import { ThreadWorkspace } from "@/components/ThreadWorkspace";
import { RuntimeProvider } from "@/components/RuntimeProvider";
import { VisualLayoutProvider } from "@/lib/visual-layout-context";
import { DEFAULT_LAYOUT_ID } from "@/lib/visual-layouts";

const DevPanel = lazy(() =>
  import("@/components/DevPanel").then((module) => ({ default: module.DevPanel })),
);

function App() {
  const layoutId = DEFAULT_LAYOUT_ID;

  return (
    <main className="h-screen w-screen" data-layout={layoutId}>
      <RuntimeProvider>
        <VisualLayoutProvider layoutId={layoutId}>
          <ThreadWorkspace />
          {import.meta.env.DEV ? (
            <Suspense fallback={null}>
              <DevPanel />
            </Suspense>
          ) : null}
        </VisualLayoutProvider>
      </RuntimeProvider>
    </main>
  );
}

export default App;
