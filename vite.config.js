import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Relative, so the built page works wherever it is served from. It was
  // put here for GitHub Pages, which served the app from a repo subpath;
  // that deployment is gone — Vercel publishes main to production and every
  // other branch to its own preview URL, both at the root — so nothing
  // needs configuring here any more. Kept relative rather than "/" because
  // it costs nothing and still works if the app is ever opened from a
  // subpath or straight off the filesystem. Safe while there is one page
  // and no router: a client-side route below the root would resolve assets
  // against the wrong directory.
  base: "./",
});
