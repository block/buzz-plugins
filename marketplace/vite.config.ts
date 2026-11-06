import { defineConfig } from "vite";
import manifest from "./manifest.json" with { type: "json" };

export default defineConfig({
  publicDir: false,
  oxc: { jsx: { runtime: "classic" } },
  build: {
    lib: { entry: "src/index.tsx", formats: ["es"], fileName: () => "plugin.js" },
    rolldownOptions: { output: { codeSplitting: false } },
    minify: false,
  },
  test: { environment: "jsdom" },
  plugins: [
    {
      name: "plugin-contract",
      enforce: "pre",
      apply: "build",
      resolveId(id) {
        if (/^react(?:-dom)?(?:\/|$)/.test(id) || id === "@buzz/author" || id.startsWith("@deepseek-ai/cordis"))
          throw new Error("Host capabilities are supplied by Buzz; use type-only imports");
      },
      generateBundle(_options, bundle) {
        const outputs = Object.values(bundle);
        const module = outputs[0];
        if (outputs.length !== 1 || module?.type !== "chunk" || module.imports.length)
          throw new Error("Plugin API v1 requires one self-contained JS module");
        if (!module.exports.includes("apply")) throw new Error("Export apply(ctx)");
        this.emitFile({ type: "asset", fileName: "manifest.json", source: `${JSON.stringify(manifest, null, 2)}\n` });
      },
    },
  ],
});
