import { defineConfig } from "vite";
export default defineConfig({
  preview: {
    // 公開プレビューでは同一オリジンのスクリプト・通信だけを許可する。
    // Reactの動的スタイルと画像選択プレビューにはstyle属性・blob画像が必要。
    headers: {
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
    },
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
