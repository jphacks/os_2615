import React from "react";
import { createRoot } from "react-dom/client";
import { applySettings, readSettings, defaultSettings } from "./services/settings.js";
import App from "./App";
import "./styles.css";
try { applySettings(readSettings(window.localStorage)); } catch { applySettings(defaultSettings); }
createRoot(document.getElementById("root")).render(<App />);
