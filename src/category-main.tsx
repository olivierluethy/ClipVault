import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/jetbrains-mono";
import CategoryWindow from "./CategoryWindow";
import "./styles.css";

// A per-category library window (issue #5) is its own entry point: opening "Links" in a
// separate window shouldn't drag in the whole timeline app.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <CategoryWindow />
  </React.StrictMode>,
);
