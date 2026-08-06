'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAccount, useWriteContract, useReadContract, useSimulateContract } from 'wagmi'
import { parseEther, formatEther, maxUint256 } from 'viem'
import { sepolia } from 'wagmi/chains'
import RouterAbi from '@/abis/DefiRouter.json'
import DefiPairAbi from '@/abis/DefiPair.json'
import ERC20Abi from '@/abis/TestToken.json'
import { ROUTER_ADDRESS, TOKEN_A_ADDRESS, TOKEN_B_ADDRESS, FACTORY_ADDRESS } from '@/lib/wagmi'
import { getAmountOut, getPrice, getPriceImpact, getMinAmountOut, formatAmount } from '@/lib/utils'
import PriceChart from '@/components/PriceChart'

// 默认滑点 0.5%
const DEFAULT_SLIPPAGE = 0.5

export default function SwapPage() {
  const { address, isConnected } = useAccount()

  // 代币选择
  const [tokenIn, setTokenIn] = useState(TOKEN_A_ADDRESS)
  const [tokenOut, setTokenOut] = useState(TOKEN_B_ADDRESS)
  const [amountIn, setAmountIn] = useState('')
  const [slippage, setSlippage] = useState(DEFAULT_SLIPPAGE)

  // 计算出的输出
  const [amountOut, setAmountOut] = useState('')
  const [minAmountOut, setMinAmountOut] = useState('')
  const [priceImpact, setPriceImpact] = useState(0)
  const [price, setPrice] = useState(0)
  const [loading, setLoading] = useState(false)

  // 读取储备量
  const { data: pairAddress } = useReadContract({
    address: FACTORY_ADDRESS as `0x${string}`,
    abi: [{ inputs: [{ name: 'a', type: 'address' }, { name: 'b', type: 'address' }], name: 'getPair', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' }],
    functionName: 'getPair',
    args: [tokenIn as `0x${string}`, tokenOut as `0x${string}`],
    chainId: sepolia.id,
  })

  const { data: reserves } = useReadContract({
    address: pairAddress as `0x${string}` | undefined,
    abi: DefiPairAbi.abi,
    functionName: 'getReserves',
    chainId: sepolia.id,
    query: { enabled: !!pairAddress && pairAddress !== '0x0000000000000000000000000000000000000000' },
  })

  const reservesData = reserves as [bigint, bigint, number] | undefined
  const pairExists = !!pairAddress && pairAddress !== '0x0000000000000000000000000000000000000000'

  // 计算输出
  useEffect(() => {
    if (!reservesData || !amountIn || !pairExists) {
      setAmountOut('')
      setMinAmountOut('')
      setPriceImpact(0)
      return
    }

    try {
      const [reserve0, reserve1] = reservesData
      const isToken0In = tokenIn.toLowerCase() === TOKEN_A_ADDRESS.toLowerCase()
      const reserveIn = isToken0In ? reserve0 : reserve1
      const reserveOut = isToken0In ? reserve1 : reserve0

      const amountInWei = parseEther(amountIn)
      const out = getAmountOut(amountInWei, reserveIn, reserveOut)
      const minOut = getMinAmountOut(out, slippage)
      const impact = getPriceImpact(amountInWei, reserveIn)
      const currentPrice = getPrice(reserve0, reserve1)

      setAmountOut(formatEther(out))
      setMinAmountOut(formatEther(minOut))
      setPriceImpact(impact)
      setPrice(isToken0In ? currentPrice : 1 / currentPrice)
    } catch {
      // 输入格式错误
    }
  }, [amountIn, reservesData, tokenIn, slippage, pairExists])

  // 交换代币
  const handleSwapTokens = useCallback(() => {
    setTokenIn(tokenOut)
    setTokenOut(tokenIn)
    setAmountIn('')
    setAmountOut('')
  }, [tokenIn, tokenOut])

  // 预判交易（useSimulateContract 预判失败）
  const { data: simulateData, error: simulateError } = useSimulateContract({
    address: ROUTER_ADDRESS as `0x${string}`,
    abi: RouterAbi.abi,
    functionName: 'swapExactTokensForTokens',
    args: amountIn && minAmountOut ? [
      parseEther(amountIn),
      parseEther(minAmountOut),
      [tokenIn as `0x${string}`, tokenOut as `0x${string}`],
      address as `0x${string}`,
      BigInt(Math.floor(Date.now() / 1000) + 1200),
    ] : undefined,
    chainId: sepolia.id,
    query: { enabled: !!amountIn && !!minAmountOut && !!address && pairExists },
  })

  const { writeContract, isPending } = useWriteContract()

  const handleSwap = () => {
    if (!simulateData?.request) return
    writeContract(simulateData.request as any)
  }

  // 读取代币余额和授权
  const { data: tokenBalance } = useReadContract({
    address: tokenIn as `0x${string}`,
    abi: ERC20Abi.abi,
    functionName: 'balanceOf',
    args: [address as `0x${string}`],
    chainId: sepolia.id,
    query: { enabled: !!address },
  })

  const { data: allowance } = useReadContract({
    address: tokenIn as `0x${string}`,
    abi: ERC20Abi.abi,
    functionName: 'allowance',
    args: [address as `0x${string}`, ROUTER_ADDRESS as `0x${string}`],
    chainId: sepolia.id,
    query: { enabled: !!address },
  })

  const needsApproval = !!amountIn && !!allowance && (allowance as bigint) < parseEther(amountIn || '0')

  const { writeContract: approve } = useWriteContract()

  const handleApprove = () => {
    approve({
      address: tokenIn as `0x${string}`,
      abi: ERC20Abi.abi,
      functionName: 'approve',
      args: [ROUTER_ADDRESS as `0x${string}`, maxUint256],
      chainId: sepolia.id,
    })
  }

  if (!isConnected) {
    return (
      <div className="max-w-md mx-auto mt-20 text-center">
        <h2 className="text-xl font-semibold mb-3">请连接钱包</h2>
        <p className="text-[var(--muted-foreground)]">使用 MetaMask 或 WalletConnect 连接钱包以进行兑换</p>
      </div>
    )
  }

  return (
    <div className="max-w-md mx-auto">
      <div className="bg-[var(--card)] border border-[var(--card-border)] rounded-xl p-6 space-y-4">
        <h2 className="text-lg font-semibold">代币兑换</h2>

        {/* 输入代币 */}
        <div className="space-y-2">
          <label className="text-sm text-[var(--muted-foreground)]">支付</label>
          <div className="flex items-center gap-2 p-3 bg-[var(--muted)] rounded-lg border border-[var(--card-border)]">
            <input
              type="number"
              placeholder="0.0"
              value={amountIn}
              onChange={(e) => setAmountIn(e.target.value)}
              className="flex-1 bg-transparent outline-none text-lg"
            />
            <span className="font-medium text-sm shrink-0">
              {tokenIn === TOKEN_A_ADDRESS ? 'TKA' : 'TKB'}
            </span>
          </div>
          {tokenBalance !== undefined && (
            <div className="text-xs text-[var(--muted-foreground)]">
              余额: {formatEther(tokenBalance as bigint)}
            </div>
          )}
        </div>

        {/* 交换按钮 */}
        <div className="flex justify-center">
          <button
            onClick={handleSwapTokens}
            className="p-2 rounded-full bg-[var(--muted)] border border-[var(--card-border)] hover:bg-indigo-100 transition-colors"
          >
            ↓
          </button>
        </div>

        {/* 输出代币 */}
        <div className="space-y-2">
          <label className="text-sm text-[var(--muted-foreground)]">获得（预估）</label>
          <div className="flex items-center gap-2 p-3 bg-[var(--muted)] rounded-lg border border-[var(--card-border)]">
            <input
              type="text"
              placeholder="0.0"
              value={amountOut.slice(0, 10)}
              readOnly
              className="flex-1 bg-transparent outline-none text-lg"
            />
            <span className="font-medium text-sm shrink-0">
              {tokenOut === TOKEN_A_ADDRESS ? 'TKA' : 'TKB'}
            </span>
          </div>
        </div>

        {/* 交易详情 */}
        {amountOut && (
          <div className="space-y-1.5 text-sm bg-[var(--muted)] rounded-lg p-3">
            <div className="flex justify-between">
              <span className="text-[var(--muted-foreground)]">当前价格</span>
              <span>
                1 {tokenIn === TOKEN_A_ADDRESS ? 'TKA' : 'TKB'} = {price.toFixed(6)}{' '}
                {tokenOut === TOKEN_A_ADDRESS ? 'TKA' : 'TKB'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--muted-foreground)]">滑点保护</span>
              <span>{minAmountOut.slice(0, 10)}</span>
            </div>
            {priceImpact > 0 && (
              <div className="flex justify-between">
                <span className="text-[var(--muted-foreground)]">价格影响</span>
                <span className={priceImpact > 5 ? 'text-red-500 font-medium' : priceImpact > 2 ? 'text-yellow-500' : ''}>
                  {priceImpact.toFixed(2)}%
                  {priceImpact > 5 && ' ⚠️ 高滑点'}
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-[var(--muted-foreground)]">手续费</span>
              <span>0.3%</span>
            </div>
          </div>
        )}

        {/* 滑点设置 */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-[var(--muted-foreground)]">滑点容忍度:</span>
          {[0.1, 0.5, 1.0].map((s) => (
            <button
              key={s}
              onClick={() => setSlippage(s)}
              className={`px-2 py-0.5 rounded text-xs ${
                slippage === s
                  ? 'bg-indigo-600 text-white'
                  : 'bg-[var(--muted)] text-[var(--muted-foreground)] hover:bg-[var(--card-border)]'
              }`}
            >
              {s}%
            </button>
          ))}
          <input
            type="number"
            value={slippage}
            onChange={(e) => setSlippage(Number(e.target.value))}
            className="w-16 text-xs bg-[var(--muted)] border border-[var(--card-border)] rounded px-1 py-0.5"
            step="0.1"
          />
          <span className="text-xs text-[var(--muted-foreground)]">%</span>
        </div>

        {/* 操作按钮 */}
        {!pairExists ? (
          <div className="p-3 text-center text-sm text-yellow-600 bg-yellow-50 rounded-lg">
            交易对不存在，请先在"流动性"页面创建
          </div>
        ) : needsApproval ? (
          <button
            onClick={handleApprove}
            className="w-full py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors"
          >
            授权 {tokenIn === TOKEN_A_ADDRESS ? 'TKA' : 'TKB'}
          </button>
        ) : (
          <button
            onClick={handleSwap}
            disabled={!amountIn || !amountOut || isPending || !!simulateError}
            className={`w-full py-3 rounded-lg font-medium transition-colors ${
              !amountIn || !amountOut || isPending || !!simulateError
                ? 'bg-gray-400 text-white cursor-not-allowed'
                : 'bg-indigo-600 text-white hover:bg-indigo-700'
            }`}
          >
            {isPending ? '交易中...' : simulateError ? `交易失败: ${(simulateError as any)?.shortMessage || '未知错误'}` : '兑换'}
          </button>
        )}
      </div>

      {/* 价格曲线图 */}
      {pairExists && reservesData && (
        <div className="mt-6">
          <PriceChart
            reserve0={reservesData[0]}
            reserve1={reservesData[1]}
            token0Symbol="TKA"
            token1Symbol="TKB"
          />
        </div>
      )}
    </div>
  )
}