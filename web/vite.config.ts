import { defineConfig, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";

// @solana/web3.js and friends expect Node's Buffer / process / global.
// Buffer and process are installed on window in src/polyfills.ts; here we
// alias the bare "buffer" import to the npm package and map `global`.
export default defineConfig({
  plugins: [react()],
  base: "./",
  define: {
    global: "globalThis",
    "process.env.ANCHOR_BROWSER": "true",
  },
  resolve: {
    alias: { buffer: "buffer/" },
  },
  optimizeDeps: {
    include: ["buffer"],
    esbuildOptions: { define: { global: "globalThis" } },
  },
  build: {
    target: "es2020",
    chunkSizeWarningLimit: 2500,
  },
  // Local stand-in for the /api/rpc Edge function: the public mainnet RPC
  // refuses requests carrying a browser Origin, so strip it server-side.
  server: { proxy: { "/api/rpc": mainnetProxy() } },
  preview: { proxy: { "/api/rpc": mainnetProxy() } },
});

function mainnetProxy(): ProxyOptions {
  return {
    target: "https://api.mainnet-beta.solana.com",
    changeOrigin: true,
    rewrite: () => "/",
    configure: (proxy) => {
      proxy.on("proxyReq", (proxyReq) => {
        proxyReq.removeHeader("origin");
        proxyReq.removeHeader("referer");
      });
    },
  };
}
