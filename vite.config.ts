import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const downloader = mode === "downloader";

  return {
    plugins: [react()],
    publicDir: downloader ? "public-downloader" : "public-app",
    server: { port: 1420, strictPort: true },
    build: {
      rollupOptions: {
        input: downloader ? "downloader.html" : "index.html",
      },
    },
  };
});
