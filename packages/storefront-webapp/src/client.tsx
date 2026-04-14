/// <reference types="vinxi/types/client" />
import React from "react";
import { hydrateRoot } from "react-dom/client";
import { StartClient } from "@tanstack/start";

hydrateRoot(
  document,
  <React.StrictMode>
    <StartClient />
  </React.StrictMode>,
);
