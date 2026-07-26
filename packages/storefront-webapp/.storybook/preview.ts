import type { Preview } from "@storybook/react-vite";

import "../src/index.css";

const preview: Preview = {
  parameters: {
    layout: "fullscreen",
    a11y: {
      test: "error",
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    options: {
      storySort: {
        order: ["Guidance", "Foundations", "Primitives", "Patterns", "Templates"],
      },
    },
  },
};

export default preview;
