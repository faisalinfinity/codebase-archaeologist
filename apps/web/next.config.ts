import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@archaeologist/shared', '@archaeologist/api', '@archaeologist/db'],
};

export default nextConfig;
