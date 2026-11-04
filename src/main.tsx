import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./ui.css";

// Kontextmenü des WebViews im Release ausblenden (außer in Eingabefeldern)
if (!import.meta.env.DEV) {
  window.addEventListener("contextmenu", (e) => {
    const t = e.target as HTMLElement;
    if (!t.closest("input, textarea")) e.preventDefault();
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
