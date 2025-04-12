import ReactDOM from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { createVersionChecker } from "./utils/versionChecker";

import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: false,
    },
  },
});

// Set up a Router instance
const router = createRouter({
  routeTree,
  context: {
    queryClient,
  },
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0,
});

// Register things for typesafety
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// App wrapper component to handle version checking
function App() {
  useEffect(() => {
    // Start version checking
    const versionChecker = createVersionChecker({
      onNewVersionAvailable: () => {
        // Save any important app state to sessionStorage
        try {
          // Save current scroll position
          const scrollPosition = {
            x: window.scrollX,
            y: window.scrollY,
          };
          sessionStorage.setItem(
            "scrollPosition",
            JSON.stringify(scrollPosition)
          );

          // Save form input state if needed
          const activeElement = document.activeElement as
            | HTMLInputElement
            | HTMLTextAreaElement;
          if (
            activeElement &&
            (activeElement.tagName === "INPUT" ||
              activeElement.tagName === "TEXTAREA")
          ) {
            sessionStorage.setItem("activeElementValue", activeElement.value);
            sessionStorage.setItem("activeElementId", activeElement.id);
          }

          // Reload the page to get the new version
          window.location.reload();
        } catch (error) {
          console.error("Error saving state before reload:", error);
          window.location.reload();
        }
      },
    });

    // Restore scroll position and form state if available
    try {
      // Restore scroll position
      const savedPosition = sessionStorage.getItem("scrollPosition");
      if (savedPosition) {
        const { x, y } = JSON.parse(savedPosition);
        setTimeout(() => window.scrollTo(x, y), 0);
        sessionStorage.removeItem("scrollPosition");
      }

      // Restore active form element if needed
      const activeElementId = sessionStorage.getItem("activeElementId");
      const activeElementValue = sessionStorage.getItem("activeElementValue");
      if (activeElementId && activeElementValue) {
        const element = document.getElementById(activeElementId) as
          | HTMLInputElement
          | HTMLTextAreaElement;
        if (element) {
          element.value = activeElementValue;
          element.focus();
        }
        sessionStorage.removeItem("activeElementId");
        sessionStorage.removeItem("activeElementValue");
      }
    } catch (error) {
      console.error("Error restoring state after reload:", error);
    }

    // Clean up on unmount
    return () => versionChecker.stop();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

const rootElement = document.getElementById("app")!;

if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(<App />);
}
