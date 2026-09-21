import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: import.meta.dirname,
  },
  // The trading dashboard is the existing Vite app, built into public/app
  // (scripts/build-app.sh). /app itself has no file, so point it at the
  // dashboard's index.
  async rewrites() {
    return [
      { source: "/app", destination: "/app/index.html" },
      // The faucet runs on Railway because its signing keys must stay in a
      // server environment. Participants reach it through this origin rather
      // than that hostname directly: some networks block *.up.railway.app —
      // ours does — and a visitor whose network does would find the one
      // action they need silently broken. Same-origin also means no CORS.
      {
        source: "/api/faucet",
        destination: `${process.env.FAUCET_ORIGIN ?? "https://uncross-faucet-production.up.railway.app"}/faucet`,
      },
      {
        source: "/api/faucet/health",
        destination: `${process.env.FAUCET_ORIGIN ?? "https://uncross-faucet-production.up.railway.app"}/health`,
      },
    ];
  },
};

export default nextConfig;
