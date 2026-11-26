import React from "react";
import { BrowserRouter } from "react-router-dom";
import AppRoutes from "./routes/AppRoutes";
import { AuthProvider } from "./features/auth/AuthProvider.jsx";
import ErrorBoundary from "./components/common/ErrorBoundary.jsx";

function App() {
  return (
    <ErrorBoundary level="app">
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
