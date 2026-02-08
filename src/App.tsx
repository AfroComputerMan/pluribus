import "./App.css";
import { DevPanel } from "@/components/DevPanel";
import { ThreadWorkspace } from "@/components/ThreadWorkspace";

function App() {
  return (
    <main className="h-screen w-screen">
      <ThreadWorkspace />
      <DevPanel />
    </main>
  );
}

export default App;
