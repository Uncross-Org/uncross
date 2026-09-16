import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: import.meta.dirname,
  },
  // The trading dashboard is the existing Vite app, built into public/app
  // (scripts/build-app.sh). /app itself has no file, so point it at the
  // dashboard's index.
  async rewrites() {
    return [{ source: "/app", destination: "/app/index.html" }];
  },
};

export default nextConfig;
