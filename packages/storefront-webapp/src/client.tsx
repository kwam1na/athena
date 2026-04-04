/// <reference types="vinxi/types/client" />
import React from "react";
import { hydrateRoot } from "react-dom/client";
import { StartClient } from "@tanstack/start";
import { PostHogProvider } from "posthog-js/react";

hydrateRoot(
  document,
  <React.StrictMode>
    <StartClient />
  </React.StrictMode>
);
