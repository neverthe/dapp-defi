'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAccount, useWriteContract, useReadContract } from 'wagmi'
import { parseEther, formatEther, maxUint256 } from 'viem'
import { sepolia } from 'wagmi/chains'
import RouterAbi from '@/abis/DefiRouter.json'
import DefiPairAbi from '@/abis/DefiPair.json'
import ERC20Abi from '@/abis/TestToken.json'
import { ROUTER_ADDRESS, TOKEN_A_ADDRESS, TOKEN_B_ADDRESS, TOKEN_C_ADDRESS, FACTORY_ADDRESS } from '@/lib/wagmi'
import { getMinAmountOut } from '@/lib/utils'
import PriceChart from '@/components/PriceChart'

// 代币列表
const TOKENS = [
  { address: TOKEN_A_ADDRESS, symbol: 'TKA' },
  { address: TOKEN_B_ADDRESS, symbol: 'TKB' },
  { address: TOKEN_C_ADDRESS, symbol: 'TKC' },
] as const

const DEFAULT_SLIPPAGE = 0.5

// 根据输入输出找最优路径
function findRoute(from: string, to: string): string[] {
  if (from === to) return []
  // 直接路径：检查是否有直连池
  const directPools = [
    [TOKEN_A_ADDRESS, TOKEN_B_ADDRESS],
    [TOKEN_B_ADDRESS, TOKEN_C_ADDRESS],
  ]
  const isDirect = directPools.some(
    ([a, b]) =>
      (a.toLowerCase() === from.toLowerCase() && b.toLowerCase() === to.toLowerCase()) ||
      (b.toLowerCase() === from.toLowerCase() && a.toLowerCase() === to.toLowerCase())
  )
  if (isDirect) return [from, to]
  // 多跳：通过 TKB 中转
  return [from, TOKEN_B_ADDRESS, to]
}

export default function SwapPage() {
  const { address, isConnected } = useAccount()

  const [tokenIn, setTokenIn] = useState(TOKEN_A_ADDRESS)
  const [tokenOut, setTokenOut] = useState(TOKEN_B_ADDRESS)
  const [amountIn, setAmountIn] = useState('')
  const [amountOut, setAmountOut] = useState('')
  const [slippage, setSlippage] = useState(DEFAULT_SLIPPAGE)
  const [lastEdited, setLastEdited] = useState<'in' | 'out'>('in')
  const [showInDropdown, setShowInDropdown] = useState(false)
  const [showOutDropdown, setShowOutDropdown] = useState(false)

  // 路由路径
  const route = useMemo(() => findRoute(tokenIn, tokenOut), [tokenIn, tokenOut])
  const isMultiHop = route.length > 2
  // 直连交易对地址（用于检查 pair 存在性和储备量）
  const directPairTokenA = route[0]
  const directPairTokenB = route.length === 2 ? route[1] : route[1]

  // 读取直连 pair（第一个跳跃的 pair）
  const { data: pairAddress } = useReadContract({
    address: FACTORY_ADDRESS as `0x${string}`,
    abi: [{ inputs: [{ name: 'a', type: 'address' }, { name: 'b', type: 'address' }], name: 'getPair', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' }],
    functionName: 'getPair',
    args: [directPairTokenA as `0x${string}`, directPairTokenB as `0x${string}`],
    chainId: sepolia.id,
  })

  const pairExists = !!pairAddress && pairAddress !== '0x0000000000000000000000000000000000000000'

  // 从 Router 查询多跳输出
  const hasInput = lastEdited === 'in' && amountIn && pairExists
  const { data: amountsOutData } = useReadContract({
    address: ROUTER_ADDRESS as `0x${string}`,
    abi: RouterAbi.abi,
    functionName: 'getAmountsOut',
    args: hasInput
      ? [parseEther(amountIn || '0'), route as `0x${string}`[]]
      : undefined,
    chainId: sepolia.id,
    query: { enabled: hasInput },
  })

  // 从 Router 查询多跳所需输入
  const hasOutput = lastEdited === 'out' && amountOut && pairExists
  const { data: amountsInData } = useReadContract({
    address: ROUTER_ADDRESS as `0x${string}`,
    abi: RouterAbi.abi,
    functionName: 'getAmountsIn',
    args: hasOutput
      ? [parseEther(amountOut || '0'), route as `0x${string}`[]]
      : undefined,
    chainId: sepolia.id,
    query: { enabled: hasOutput },
  })

  // 解析多跳计算结果
  useEffect(() => {
    if (lastEdited === 'in' && amountsOutData) {
      const amounts = amountsOutData as bigint[]
      const finalOut = amounts[amounts.length - 1]
      setAmountOut(formatEther(finalOut))
    } else if (lastEdited === 'out' && amountsInData) {
      const amounts = amountsInData as bigint[]
      setAmountIn(formatEther(amounts[0]))
    } else if (!amountIn && !amountOut) {
      setAmountOut('')
    }
  }, [amountsOutData, amountsInData, lastEdited, amountIn, amountOut])

  // 计算价格影响、滑点等
  const displayAmountOut = (() => {
    if (lastEdited === 'in' && amountsOutData) {
      const amounts = amountsOutData as bigint[]
      return amounts[amounts.length - 1]
    }
    if (amountOut) return parseEther(amountOut || '0')
    return 0n
  })()
  const displayAmountIn = (() => {
    if (lastEdited === 'out' && amountsInData) {
      const amounts = amountsInData as bigint[]
      return amounts[0]
    }
    if (amountIn) return parseEther(amountIn || '0')
    return 0n
  })()

  const minOut = displayAmountOut > 0n ? getMinAmountOut(displayAmountOut, slippage) : 0n

  const { data: reserves } = useReadContract({
    address: pairAddress as `0x${string}` | undefined,
    abi: DefiPairAbi.abi,
    functionName: 'getReserves',
    chainId: sepolia.id,
    query: { enabled: pairExists },
  })

  const reservesData = reserves as [bigint, bigint, number] | undefined
  const hasLiquidity = !!reservesData?.[0] && reservesData[0] > 0n

  // 价格影响
  const priceImpact = (() => {
    if (!reservesData || displayAmountIn === 0n) return 0
    const isToken0 = directPairTokenA.toLowerCase() === TOKEN_A_ADDRESS.toLowerCase()
    const reserveIn = isToken0 ? reservesData[0] : reservesData[1]
    return Number(displayAmountIn) / (Number(reserveIn) + Number(displayAmountIn)) * 100
  })()

  // 交换代币位置
  const handleSwapTokens = useCallback(() => {
    setTokenIn(tokenOut)
    setTokenOut(tokenIn)
    setAmountIn('')
    setAmountOut('')
    setLastEdited('in')
  }, [tokenIn, tokenOut])

  // 执行兑换
  const { writeContract, isPending } = useWriteContract()

  const handleSwap = () => {
    if (!amountIn || !minOut || !address) return
    writeContract({
      address: ROUTER_ADDRESS as `0x${string}`,
      abi: RouterAbi.abi,
      functionName: 'swapExactTokensForTokens',
      args: [
        parseEther(amountIn),
        minOut,
        route as `0x${string}`[],
        address as `0x${string}`,
        BigInt(Math.floor(Date.now() / 1000) + 1200),
      ],
      chainId: sepolia.id,
    })
  }

  // 余额和授权
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

  const { writeContract: approve, isPending: isApproving } = useWriteContract()

  const handleApprove = () => {
    approve({
      address: tokenIn as `0x${string}`,
      abi: ERC20Abi.abi,
      functionName: 'approve',
      args: [ROUTER_ADDRESS as `0x${string}`, maxUint256],
      chainId: sepolia.id,
    })
  }

  const tokenInSymbol = TOKENS.find(t => t.address === tokenIn)?.symbol || '???'
  const tokenOutSymbol = TOKENS.find(t => t.address === tokenOut)?.symbol || '???'
  const routeStr = route.map(a => TOKENS.find(t => t.address.toLowerCase() === a.toLowerCase())?.symbol || a.slice(0,6)).join(' → ')

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

        {/* 路由展示 */}
        {route.length > 0 && (
          <div className="text-xs text-[var(--muted-foreground)] bg-[var(--muted)] rounded-lg px-3 py-1.5 text-center">
            路由: {routeStr}
            {isMultiHop && <span className="ml-1 text-indigo-500 font-medium">（多跳）</span>}
          </div>
        )}

        {/* 输入代币 */}
        <div className="space-y-2">
          <label className="text-sm text-[var(--muted-foreground)]">支付</label>
          <div className="flex items-center gap-2 p-3 bg-[var(--muted)] rounded-lg border border-[var(--card-border)]">
            <input
              type="number"
              placeholder="0.0"
              value={amountIn}
              onChange={(e) => { setAmountIn(e.target.value); setLastEdited('in') }}
              className="flex-1 bg-transparent outline-none text-lg"
            />
            <div className="relative shrink-0">
              <button
                onClick={() => { setShowInDropdown(!showInDropdown); setShowOutDropdown(false) }}
                className="flex items-center gap-1 px-2 py-1 bg-[var(--card-border)] rounded-lg text-sm font-medium hover:bg-indigo-100 transition-colors"
              >
                {tokenInSymbol} ▼
              </button>
              {showInDropdown && (
                <div className="absolute right-0 top-full mt-1 bg-[var(--card)] border border-[var(--card-border)] rounded-lg shadow-lg z-10 min-w-[80px]">
                  {TOKENS.filter(t => t.address !== tokenOut).map(t => (
                    <button
                      key={t.address}
                      onClick={() => { setTokenIn(t.address); setShowInDropdown(false); setAmountIn(''); setAmountOut('') }}
                      className={`block w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--muted)] ${t.address === tokenIn ? 'font-bold text-indigo-600' : ''}`}
                    >
                      {t.symbol}
                    </button>
                  ))}
                </div>
              )}
            </div>
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
              type="number"
              placeholder="0.0"
              value={lastEdited === 'in' ? formatEther(displayAmountOut).slice(0, 10) : amountOut}
              onChange={(e) => { setAmountOut(e.target.value); setLastEdited('out') }}
              className="flex-1 bg-transparent outline-none text-lg"
            />
            <div className="relative shrink-0">
              <button
                onClick={() => { setShowOutDropdown(!showOutDropdown); setShowInDropdown(false) }}
                className="flex items-center gap-1 px-2 py-1 bg-[var(--card-border)] rounded-lg text-sm font-medium hover:bg-indigo-100 transition-colors"
              >
                {tokenOutSymbol} ▼
              </button>
              {showOutDropdown && (
                <div className="absolute right-0 top-full mt-1 bg-[var(--card)] border border-[var(--card-border)] rounded-lg shadow-lg z-10 min-w-[80px]">
                  {TOKENS.filter(t => t.address !== tokenIn).map(t => (
                    <button
                      key={t.address}
                      onClick={() => { setTokenOut(t.address); setShowOutDropdown(false); setAmountIn(''); setAmountOut('') }}
                      className={`block w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--muted)] ${t.address === tokenOut ? 'font-bold text-indigo-600' : ''}`}
                    >
                      {t.symbol}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 交易详情 */}
        {displayAmountOut > 0n && (
          <div className="space-y-1.5 text-sm bg-[var(--muted)] rounded-lg p-3">
            <div className="flex justify-between">
              <span className="text-[var(--muted-foreground)]">路由</span>
              <span className={isMultiHop ? 'text-indigo-500 font-medium' : ''}>
                {routeStr} {isMultiHop && '(多跳)'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--muted-foreground)]">滑点保护</span>
              <span>{formatEther(minOut).slice(0, 10)} {tokenOutSymbol}</span>
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
              <span>0.3%{isMultiHop ? ' × 2' : ''}</span>
            </div>
          </div>
        )}

        {/* 滑点设置 */}
        <div className="flex items-center gap-2 flex-wrap">
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
        ) : !hasLiquidity ? (
          <div className="p-3 text-center text-sm text-yellow-600 bg-yellow-50 rounded-lg">
            池子暂无流动性，请先在"流动性"页面添加
          </div>
        ) : needsApproval ? (
          <button
            onClick={handleApprove}
            disabled={isApproving}
            className={`w-full py-3 bg-indigo-600 text-white rounded-lg font-medium transition-colors ${isApproving ? 'opacity-50' : 'hover:bg-indigo-700'}`}
          >
            {isApproving ? '授权中...' : `授权 ${tokenInSymbol}`}
          </button>
        ) : (
          <button
            onClick={handleSwap}
            disabled={!amountIn || (!amountOut && lastEdited === 'in') || isPending}
            className={`w-full py-3 rounded-lg font-medium transition-colors ${
              !amountIn || (!amountOut && lastEdited === 'in') || isPending
                ? 'bg-gray-400 text-white cursor-not-allowed'
                : 'bg-indigo-600 text-white hover:bg-indigo-700'
            }`}
          >
            {isPending ? '交易中...' : '兑换'}
          </button>
        )}
      </div>

      {/* 价格曲线图（仅直连时显示） */}
      {pairExists && reservesData && hasLiquidity && !isMultiHop && (
        <div className="mt-6">
          <PriceChart
            reserve0={reservesData[0]}
            reserve1={reservesData[1]}
            token0Symbol={tokenInSymbol}
            token1Symbol={tokenOutSymbol}
          />
        </div>
      )}
    </div>
  )
}
