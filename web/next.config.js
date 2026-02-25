/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: __dirname,
  distDir: process.env.NODE_ENV === 'production' ? '.next_build' : '.next',
}

module.exports = nextConfig
