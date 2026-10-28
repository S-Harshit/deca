import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import "./themes.css"; // after the app's own styles, so a look can override them

createRoot(document.getElementById("root")!).render(<App />);
