import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev only: let phones on the same Wi-Fi open the dev server via the laptop's LAN IP.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*"],
};

export default nextConfig;
