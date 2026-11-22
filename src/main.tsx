import ReactDOM from "react-dom/client";

import "@fontsource-variable/montserrat";
import "./styles/tokens.css";
import "./styles/global.css";

import App from "./App";
import MiniApp from "./MiniApp";

declare global {
  interface Window {
    __HUSH_MINI__?: boolean;
  }
}

const isMini =
  window.__HUSH_MINI__ === true ||
  window.location.hash.startsWith("#/mini");

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing #root element");

ReactDOM.createRoot(rootElement).render(isMini ? <MiniApp /> : <App />);
