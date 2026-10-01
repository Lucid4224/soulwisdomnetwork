import type { NextConfig } from "next";

// Security headers on every page. Framing is limited to this site ('self', not 'none': Firebase
// sign-in can load its helper frame from our own domain), which stops other sites from wrapping
// the admin pages to trick clicks. No Cross-Origin-Opener-Policy: it would break the Google
// sign-in popup.
const securityHeaders = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // The Signal, Curate and Daily pages were removed; old links land on the home page.
  async redirects() {
    return ["/signal", "/curate", "/daily"].map(source => ({ source, destination: "/", permanent: true }));
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
