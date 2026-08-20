import type { NextConfig } from "next";

const basePath = process.env.BASE_PATH || "";

const nextConfig: NextConfig = {
  // Support deployment behind a reverse proxy at a subpath (e.g., BASE_PATH=/files)
  basePath: basePath || undefined,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  serverExternalPackages: ["ssh2", "better-sqlite3", "ws", "@fastify/busboy"],
  turbopack: {},
  webpack: (config) => {
    config.module.rules.push({ test: /\.md$/, type: "asset/source" });
    return config;
  },
};

export default nextConfig;
