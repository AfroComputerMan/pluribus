import { Routes, Route } from 'react-router-dom';

function HomePage() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">
          Pluribus Desktop
        </h1>
        <p className="text-lg text-gray-600">
          Agent Organization System
        </p>
        <p className="text-sm text-gray-500 mt-2">
          Tauri 2.0 • React 19 • TypeScript
        </p>
      </div>
    </div>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
    </Routes>
  );
}

export default App;
