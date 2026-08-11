import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_SUBGRAPH_URL: process.env.NEXT_PUBLIC_SUBGRAPH_URL || '',
    NEXT_PUBLIC_ROUTER_ADDRESS: process.env.NEXT_PUBLIC_ROUTER_ADDRESS || '',
    NEXT_PUBLIC_FACTORY_ADDRESS: process.env.NEXT_PUBLIC_FACTORY_ADDRESS || '',
    NEXT_PUBLIC_TOKEN_A: process.env.NEXT_PUBLIC_TOKEN_A || '',
    NEXT_PUBLIC_TOKEN_B: process.env.NEXT_PUBLIC_TOKEN_B || '',
    NEXT_PUBLIC_PAIR_ADDRESS: process.env.NEXT_PUBLIC_PAIR_ADDRESS || '',
    NEXT_PUBLIC_SEPOLIA_RPC_URL: process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL || '',
  },
};

export default nextConfig;