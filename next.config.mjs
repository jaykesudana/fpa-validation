/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['@neondatabase/serverless', 'xlsx', 'pptxgenjs'],
  },
};

export default nextConfig;
