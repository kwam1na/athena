import "../packages/athena-webapp/src/index.css";
import "./storybook.css";
import {
  athenaRadiusGlobalType,
  athenaThemeGlobalType,
  withAthenaTheme,
} from "../packages/athena-webapp/src/stories/storybook-theme-decorator";

const preview = {
  decorators: [withAthenaTheme],
  globalTypes: {
    theme: athenaThemeGlobalType,
    radius: athenaRadiusGlobalType,
  },
  initialGlobals: {
    theme: "light",
    radius: "generous",
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
