/// <reference types="vinxi/types/client" />
import React from "react";
import { hydrateRoot } from "react-dom/client";
import { StartClient } from "@tanstack/start";
import { createRouter } from "./router";
import { PostHogProvider } from "posthog-js/react";

const router = createRouter();

hydrateRoot(
  document,
  <React.StrictMode>
    <StartClient router={router} />
  </React.StrictMode>
);
