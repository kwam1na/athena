import type { Preview } from "@storybook/react-vite";
import "../src/index.css";
import "./storybook.css";
import {
  athenaThemeGlobalType,
  withAthenaTheme,
} from "../src/stories/storybook-theme-decorator";

const preview: Preview = {
  decorators: [withAthenaTheme],
  globalTypes: {
    theme: athenaThemeGlobalType,
  },
  initialGlobals: {
    theme: "light",
  },
  parameters: {
    layout: "fullscreen",
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
