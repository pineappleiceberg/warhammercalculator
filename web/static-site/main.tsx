import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Home from "../app/page";
import ArmyLists from "../app/lists/page";
import PlayMode from "../app/play/page";
import UnitVsUnit from "../app/unit-vs-unit/page";
import "../app/globals.css";

const root = document.getElementById("root");

if (!root) throw new Error("Root element unavailable");

const route = window.location.pathname.replace(/\/$/, "").split("/").pop();
const Page =
  route === "unit-vs-unit"
    ? UnitVsUnit
    : route === "lists"
      ? ArmyLists
      : route === "play"
        ? PlayMode
        : Home;

createRoot(root).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);
