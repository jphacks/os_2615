import React from "react";
import { createRoot } from "react-dom/client";
import { applySettings, readSettings, defaultSettings } from "./services/settings.js";
import App from "./App";
import "./styles.css";
try { applySettings(readSettings(window.localStorage)); } catch { applySettings(defaultSettings); }
class StartupBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <div role="alert" style={{padding:24}}><h1>画面を表示できませんでした</h1><p>ページを再読み込みしてください。</p><button onClick={() => window.location.reload()}>再読み込み</button></div>;
    return this.props.children;
  }
}
createRoot(document.getElementById("root")).render(<StartupBoundary><App /></StartupBoundary>);
