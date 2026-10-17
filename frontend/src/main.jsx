import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { I18nProvider } from "./i18n/index.jsx";
import "./styles.css";

function render() {
  createRoot(document.getElementById("root")).render(
    <StrictMode>
      <I18nProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </I18nProvider>
    </StrictMode>,
  );
}

// Links shown to the operator must work on phones. If this page was opened as localhost, ask the server for its
// network address first (one tiny request, only on the operator's own computer).
if (["localhost", "127.0.0.1"].includes(window.location.hostname)) {
  fetch("/api/base").then((r) => r.json()).then((d) => { window.__QS_BASE__ = d.base_url; }).catch(() => {}).finally(render);
} else {
  render();
}
