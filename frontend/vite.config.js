import { defineConfig } from "vite";
export default defineConfig({
  preview: {
    port: 5174,
    allowedHosts: process.env.PWA_PUBLIC_HOST ? [process.env.PWA_PUBLIC_HOST] : [],
    strictPort: true,
    proxy: {
      "/api": { target: process.env.API_PROXY_TARGET || "http://127.0.0.1:3000", changeOrigin: true },
      "/media": { target: "http://127.0.0.1:3001", changeOrigin: true },
      "/webhooks/line": { target: "http://127.0.0.1:3001", changeOrigin: true },
    },
  },
  server: {
    proxy: {
      "/api": {
        target: process.env.API_PROXY_TARGET || "http://127.0.0.1:3000",
        changeOrigin: true,
      },
    },
  },
});
