import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "@react-pdf/renderer", "exceljs"],
  outputFileTracingIncludes: { "/api/reports/[kind]": ["./assets/fonts/**"] },
  devIndicators: false,
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
};

export default nextConfig;
