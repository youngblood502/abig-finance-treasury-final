import type { NextConfig } from "next";

const prod = process.env.NODE_ENV === "production";
// Scripts need 'unsafe-inline' for Next's hydration data; everything else is locked to this site.
const csp = ["default-src 'self'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "font-src 'self'", "connect-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"].join("; ");

const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // pdfkit reads its font metrics from its own folder at run time, so it and exceljs load from node_modules rather than being bundled.
  serverExternalPackages: ["pg", "nodemailer", "pdfkit", "exceljs"],
  experimental: { serverActions: { bodySizeLimit: "12mb" } },
  async headers() {
    if (!prod) return [];
    return [{ source: "/:path*", headers: [
      { key: "Content-Security-Policy", value: csp },
      { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
      { key: "X-Content-Type-Options", value: "nosniff" }, { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "same-origin" }, { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      { key: "Cache-Control", value: "private, no-store" },
    ] }];
  },
};
export default config;
