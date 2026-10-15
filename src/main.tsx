import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { isNativeApp } from "./native";
import { startTranslator } from "./i18n";

// Den inbyggda appen har allt i paketet och saknar stöd för service workers (den körs på
// capacitor://) – där laddas filerna direkt från appen i stället.
if ("serviceWorker" in navigator && !isNativeApp()) {
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

startTranslator();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
