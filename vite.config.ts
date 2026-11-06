import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const path = (relative: string) =>
  fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  root: path("./src/web"),
  plugins: [react({ compiler: true }), tailwindcss()],
  resolve: {
    alias: {
      "@": path("./src/web"),
      "@shared": path("./src/shared"),
    },
  },
  build: {
    outDir: path("./dist/web"),
    emptyOutDir: true,
  },
});
