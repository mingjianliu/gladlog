import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

if (import.meta.env.VITE_FIXTURE_MODE) {
  const { installFixtureBridge } = await import("./fixtureBridge");
  installFixtureBridge();
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
