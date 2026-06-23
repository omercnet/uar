import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@uar/core', '@uar/api', '@uar/connectors', '@uar/reporting'],
};

export default nextConfig;
