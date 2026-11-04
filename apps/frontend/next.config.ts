import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the devtools indicator away from the admin sidebar footer.
  devIndicators: { position: 'bottom-right' },
  // Allow a second dev server (different build dir) when another dev server
  // already holds the default .next lock.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
};

export default nextConfig;
