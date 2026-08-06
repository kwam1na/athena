import "./docs-texture.css";

/**
 * Fixed dot-grid texture behind the docs workspace.
 *
 * Sits at `z-index: 0` so it paints above the shell's background but below the
 * header, content column, and floating controls, all of which stack above it.
 */
export function DocsTexture() {
  return <div aria-hidden="true" className="docs-texture" />;
}

export default DocsTexture;
