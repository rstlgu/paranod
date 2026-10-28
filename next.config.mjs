const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'img.logo.dev',
        pathname: '/**'
      }
    ],
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 60 * 60 * 24
  },
  transpilePackages: ['geist', 'reactflow'],
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Ensure server runtime can resolve dynamically loaded chunks via `require("./<chunk>.js")`
      // (the Next-generated server webpack runtime uses a relative require).
      config.output.chunkFilename = '[id].js';
    }
    return config;
  }
};

export default nextConfig;
