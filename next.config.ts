import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse → pdfjs-dist spawns a "fake worker" that imports
  // pdf.worker.mjs from a path relative to its own bundle. Next's bundler
  // doesn't preserve that path. Externalizing the package keeps it on the
  // node_modules filesystem so the worker resolves.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
};

export default nextConfig;
