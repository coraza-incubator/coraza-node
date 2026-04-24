/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  experimental: {
    // Node runtime for middleware was gated behind this flag in Next 14
    // (introduced in 14.x as experimental; became default in Next 15).
    nodeMiddleware: true,
    serverComponentsExternalPackages: ['@coraza/core'],
  },
}
