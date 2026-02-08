import "./App.css";
import { RuntimeProvider } from "@/components/RuntimeProvider";
import { Thread } from "@/components/assistant-ui/thread";

function App() {
  return (
    <RuntimeProvider>
      <main className="h-screen w-screen">
        <Thread />
      </main>
    </RuntimeProvider>
  );
}

export default App;
