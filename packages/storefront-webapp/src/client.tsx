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
    <PostHogProvider
      apiKey={import.meta.env.VITE_PUBLIC_POSTHOG_KEY}
      options={{
        api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST,
        defaults: "2025-05-24",
        capture_exceptions: false, // Disable exception capturing to reduce logging
        debug: false, // Disable debug logging
        disable_session_recording: true, // Disable session recording to stop snapshot events
        autocapture: false, // Disable automatic event capture
        capture_pageview: false, // Disable automatic pageview capture
        capture_pageleave: false, // Disable page leave events
      }}
    >
      <StartClient router={router} />
    </PostHogProvider>
  </React.StrictMode>
);
