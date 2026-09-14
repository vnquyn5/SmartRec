import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import AppRoutes from './routes/AppRoutes';

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-dark text-white font-sans">
        <header className="bg-primary p-4 shadow-md">
          <h1 className="text-2xl font-bold">SmartRec</h1>
        </header>
        <main className="container mx-auto p-4">
          <AppRoutes />
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
