import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  root: path.resolve(import.meta.dirname),
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: "dist",
    minify: true,
  },
});
