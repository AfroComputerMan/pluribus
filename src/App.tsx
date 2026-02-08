import "./App.css";
import { lazy, Suspense } from "react";
import { ThreadWorkspace } from "@/components/ThreadWorkspace";
import { RuntimeProvider } from "@/components/RuntimeProvider";

const DevPanel = lazy(() =>
  import("@/components/DevPanel").then((module) => ({ default: module.DevPanel })),
);

function App() {
  return (
    <main className="h-screen w-screen">
      <RuntimeProvider>
        <ThreadWorkspace />
      </RuntimeProvider>
      {import.meta.env.DEV ? (
        <Suspense fallback={null}>
          <DevPanel />
        </Suspense>
      ) : null}
    </main>
  );
}

export default App;
