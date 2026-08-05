import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Home from "../app/page";
import "../app/globals.css";

const root = document.getElementById("root");

if (!root) throw new Error("Root element unavailable");

createRoot(root).render(
  <StrictMode>
    <Home />
  </StrictMode>,
);
