import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the devtools indicator away from the admin sidebar footer.
  devIndicators: { position: 'bottom-right' },
};

export default nextConfig;
