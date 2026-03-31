import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/index.css";
import App from "./App.tsx";
import { ToastProvider } from "./contexts/ToastContext";
import { UploadProvider } from "./contexts/UploadContext";
import { ErrorBoundary } from "./components/ErrorBoundary";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <UploadProvider>
          <App />
        </UploadProvider>
      </ToastProvider>
    </ErrorBoundary>
  </StrictMode>
);
