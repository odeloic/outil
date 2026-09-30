/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import devServer from "@hono/vite-dev-server";

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [
    react(),
    devServer({ entry: "src/server/app.ts", exclude: [/^(?!\/api).*/] }),
  ],
  // The SSR build (the bin) goes to dist/server via --outDir and needs no public/ files
  build: { outDir: "dist/client", copyPublicDir: !isSsrBuild },
  server: { open: true },
  test: { testTimeout: 30_000 },
}));
