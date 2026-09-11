import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  devIndicators: false,
  // Next 16.3 auto-generates AGENTS.md/CLAUDE.md on dev/build; opt out so the
  // version bump introduces no new repo files (see generate-agent-files.js).
  agentRules: false,
};

export default nextConfig;
