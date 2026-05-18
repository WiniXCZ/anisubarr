import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,           // listen on 0.0.0.0 — přístupné z lokální sítě
    port: 5173,
    allowedHosts: "all",  // povolí přístup z externích IP (bez tohoto Vite 5 blokuje)
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
