import React from "react";
import ReactDOM from "react-dom/client";

import "leaflet/dist/leaflet.css";
import "./index.css";
import "./App.css";

import App from "./App";
import { BrowserRouter } from "react-router-dom";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
