import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

if ("serviceWorker" in navigator) {
  const serviceWorkerUrl = `${import.meta.env.BASE_URL}sw.js`;
  const serviceWorkerScope = import.meta.env.BASE_URL;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    window.location.reload();
  });

  navigator.serviceWorker
    .register(serviceWorkerUrl, { scope: serviceWorkerScope })
    .then((registration) => {
      void registration.update();
      window.addEventListener("focus", () => {
        void registration.update();
      });
    })
    .catch(() => undefined);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
