import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev servers normally only answer requests addressed to themselves. The
  // hosted preview (and phone testing over a tunnel) reaches the server through
  // a proxy hostname, so those origins have to be allowed explicitly.
  allowedDevOrigins: ["*.e2b.app", "*.e2b.dev", "localhost", "127.0.0.1"],
};

export default nextConfig;
