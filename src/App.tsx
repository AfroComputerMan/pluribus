import "./App.css";
import { DevPanel } from "@/components/DevPanel";
import { RuntimeProvider } from "@/components/RuntimeProvider";
import { Thread } from "@/components/assistant-ui/thread";

function App() {
  return (
    <RuntimeProvider>
      <main className="h-screen w-screen">
        <Thread />
        <DevPanel />
      </main>
    </RuntimeProvider>
  );
}

export default App;
