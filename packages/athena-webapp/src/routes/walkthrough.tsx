import { createFileRoute, redirect } from "@tanstack/react-router";

// The interest form used to live at /walkthrough. It now lives at
// /register-interest; keep this path as a permanent redirect so existing links
// and bookmarks don't 404.
export const Route = createFileRoute("/walkthrough")({
  beforeLoad: () => {
    throw redirect({ to: "/register-interest" });
  },
});
