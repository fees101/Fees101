import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Without this, Next/Turbopack walks up and finds the sibling schools-facing
  // app's package-lock.json, infers a monorepo root one level up, and starts
  // resolving this app's own files (like middleware.ts) against that sibling
  // app's src/ instead of this one's.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
