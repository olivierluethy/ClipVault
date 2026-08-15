import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/jetbrains-mono";
import Palette from "./Palette";
import "./styles.css";

// The palette is a separate window, so it gets its own entry point rather than routing
// inside the main app — nothing of the timeline should be loaded to paste one line.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Palette />
  </React.StrictMode>,
);
