import { http, createConfig, fallback } from 'wagmi'
import { hardhat, sepolia } from 'wagmi/chains'
import { metaMask, walletConnect } from 'wagmi/connectors'

// 合约地址（从 .env 读取）
export const FACTORY_ADDRESS = process.env.NEXT_PUBLIC_FACTORY_ADDRESS || '0x'
export const ROUTER_ADDRESS = process.env.NEXT_PUBLIC_ROUTER_ADDRESS || '0x'
export const TOKEN_A_ADDRESS = process.env.NEXT_PUBLIC_TOKEN_A || '0x'
export const TOKEN_B_ADDRESS = process.env.NEXT_PUBLIC_TOKEN_B || '0x'
export const TOKEN_C_ADDRESS = process.env.NEXT_PUBLIC_TOKEN_C || '0x'

const sepoliaRpcUrls = [
  process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL,
  'https://ethereum-sepolia.publicnode.com',
  'https://1rpc.io/sepolia',
  'https://rpc.sepolia.ethpandaops.io',
  'https://endpoints.omniatech.io/1/ethereum/sepolia/public',
].filter(Boolean) as string[]

export const config = createConfig({
  chains: [sepolia, hardhat],
  connectors: [
    metaMask({
      dappMetadata: {
        name: 'DeFi Swap DApp',
        url: 'http://localhost:3003',
      },
    }),
    walletConnect({ projectId: 'e618174c67748f7b65e9d54b89ed2741' }),
  ],
  transports: {
    [hardhat.id]: http('http://127.0.0.1:8545'),
    [sepolia.id]: fallback(sepoliaRpcUrls.map(url => http(url, {
      timeout: 10_000,       // 10 秒超时就换下一个 RPC
      retryCount: 0,          // 当前 RPC 不重试，直接 fallback
      retryDelay: 500,
    }))),
  },
  batch: {
    multicall: false,
  },
})