import type { NextConfig } from "next";

/**
 * Baseline security headers for every response. The CSP is deliberately small: it forbids framing
 * (clickjacking), plugins and `<base>` hijacking without restricting scripts, which would need
 * per-request nonces and force every page to render dynamically. (No `form-action`: the no-JS
 * Google sign-in form is answered with a redirect to Supabase/Google, which it would block.)
 */
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    // Keep pages the player has seen (or that were loaded ahead, below) in the browser for a while,
    // so going back to Today or the leaderboard is instant. Starting or finishing a game calls
    // refresh() (src/app/_play/actions.ts), which drops these copies, so Today never shows a stale
    // result. Loaded ahead: the bottom nav, the game cards and "back to today" (prefetch={true}).
    staleTimes: { dynamic: 60, static: 300 },
  },
  // Dev only: let phones on the same Wi-Fi open the dev server via the laptop's LAN IP.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*"],
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  // Fade to Color was called Color Barcode while it was built.
  async redirects() {
    return [{ source: "/play/color-barcode", destination: "/play/fade-to-color", permanent: true }];
  },
};

export default nextConfig;
