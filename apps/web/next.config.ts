import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@archaeologist/shared', '@archaeologist/api', '@archaeologist/db'],
  serverExternalPackages: ['bullmq', 'ioredis'],
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      // Optional BullMQ peer; we use ioredis.
      '@valkey/valkey-glide': false,
    };
    return config;
  },
};

export default nextConfig;
