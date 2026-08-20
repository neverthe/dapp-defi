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
// // 没有 TKA-TKC 直连池，自动找到路径：TKA → TKB → TKC 返回: [TOKEN_A_ADDRESS, TOKEN_B_ADDRESS, TOKEN_C_ADDRESS]
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
  // 多跳：通过 TKB 中转  这是简化版本，用于演示多跳概念
  return [from, TOKEN_B_ADDRESS, to]
}

export default function SwapPage() {
  const { address, isConnected } = useAccount()

  const [tokenIn, setTokenIn] = useState(TOKEN_A_ADDRESS)// 支付代币的名字
  const [tokenOut, setTokenOut] = useState(TOKEN_B_ADDRESS)// 获得代币的名字
  const [amountIn, setAmountIn] = useState('') // 支付金额
  const [amountOut, setAmountOut] = useState('') // 获得金额
  const [slippage, setSlippage] = useState(DEFAULT_SLIPPAGE)  // 滑点 0.5%
  const [lastEdited, setLastEdited] = useState<'in' | 'out'>('in') // 最后编辑的字段
  const [showInDropdown, setShowInDropdown] = useState(false) // 显示输入下拉（选择输入哪个代币的下拉框）
  const [showOutDropdown, setShowOutDropdown] = useState(false) //显示输出下拉

  // 路由路径
  // 使用 useMemo：只在 tokenIn/tokenOut 变化时重新计算
  // 这是"路径规划器"——决定兑换要走哪条路
  const route = useMemo(() => findRoute(tokenIn, tokenOut), [tokenIn, tokenOut])
  const isMultiHop = route.length > 2 // 显示"多跳"标签
  // 直连交易对地址（用于检查 pair 存在性和储备量）
  const directPairTokenA = route[0]
  // 因为路由是一个连续的路径。第一步：A → B（使用 A-B 池子）第二步：B → C（使用 B-C 池子）
  // 每个池子都是由路径中相邻的两个元素组成的，第一个池子必然是 [path[0], path[1]]。
  const directPairTokenB = route.length === 2 ? route[1] : route[1]

  // 读取直连 pair（第一个跳跃的 pair）
  const { data: pairAddress } = useReadContract({
    address: FACTORY_ADDRESS as `0x${string}`,
    // 完整 ABI：从 .sol 编译生成，包含所有函数（推荐）
    // 精简 ABI：只包含需要的函数，代码更小（节省体积）
    abi: [{ inputs: [{ name: 'a', type: 'address' }, { name: 'b', type: 'address' }], name: 'getPair', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' }],
    functionName: 'getPair',
    args: [directPairTokenA as `0x${string}`, directPairTokenB as `0x${string}`],
    chainId: sepolia.id,
  })

  const pairExists = !!pairAddress && pairAddress !== '0x0000000000000000000000000000000000000000'

  // 从 Router 查询多跳输出
  //用户最后编辑的是"支付"字段 amountIn 用户输入了金额  pairExists交易对存在
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
      // amountsOutData = [1000000000000000000n, 50000000000000000n]
      // 用户输入，
      const amounts = amountsOutData as bigint[]
      const finalOut = amounts[amounts.length - 1]
      setAmountOut(formatEther(finalOut))
    } else if (lastEdited === 'out' && amountsInData) {
      const amounts = amountsInData as bigint[]
      setAmountIn(formatEther(amounts[0]))
    } else if (!amountIn && !amountOut) {
      setAmountOut('')
    }
    // 查询结果返回，用户切换编辑字段，用户输入金额
  }, [amountsOutData, amountsInData, lastEdited, amountIn, amountOut])

  // 计算价格影响、滑点等
  const displayAmountOut = (() => {
     // 情况1：用户编辑"支付"字段，且有查询结果
    if (lastEdited === 'in' && amountsOutData) {
      const amounts = amountsOutData as bigint[]
      return amounts[amounts.length - 1]
    }
     // 情况2：用户直接输入了"获得"金额
    if (amountOut) return parseEther(amountOut || '0')
       // 情况3：什么都没有
    return 0n
  })()
  const displayAmountIn = (() => {
     // 情况1：用户编辑"获得"字段，通过查询计算所需输入
    if (lastEdited === 'out' && amountsInData) {
      const amounts = amountsInData as bigint[]
      return amounts[0]
    }
      // 情况2：用户直接输入了"支付"金额
    if (amountIn) return parseEther(amountIn || '0')
    return 0n
  })()
// 用户预期得到 100 TKB，设置滑点 0.5%(displayAmountOut, slippage)// 最小99.5 TKB
// minOut 是用户资金的"安全网"，确保即使价格波动，用户也不会遭受超出预期的损失
  const minOut = displayAmountOut > 0n ? getMinAmountOut(displayAmountOut, slippage) : 0n

  // 调用 Pair 合约的 getReserves 函数，获取池子中两种代币的储备量，并判断池子是否有流动性。
  const { data: reserves } = useReadContract({
    address: pairAddress as `0x${string}` | undefined,
    abi: DefiPairAbi.abi,
    functionName: 'getReserves',
    chainId: sepolia.id,
    query: { enabled: pairExists },
  })
// 类型断言。getReserves 返回一个三元组 (reserve0, reserve1, blockTimestampLast)，分别是大整数、大整数、数字。
  const reservesData = reserves as [bigint, bigint, number] | undefined
  // 检查池子是否有流动性。如果储备量为 0，说明没有人添加流动性，交易会失败。
  const hasLiquidity = !!reservesData?.[0] && reservesData[0] > 0n

  // 价格影响
  const priceImpact = (() => {
    //   // 1. 检查条件：必须有储备量数据，且输入金额大于0
    if (!reservesData || displayAmountIn === 0n) return 0
    // // 2. 判断输入代币是 token0 还是 token1
    const isToken0 = directPairTokenA.toLowerCase() === TOKEN_A_ADDRESS.toLowerCase()
    // 3. 获取对应的储备量
    const reserveIn = isToken0 ? reservesData[0] : reservesData[1]
      // 4. 计算价格影响：输入金额 / (储备量 + 输入金额) × 100%
      // 无法控制，由交易大小决定
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
      // 1. 安全检查：必须有输入金额、滑点保护值、钱包地址
    if (!amountIn || !minOut || !address) return
    writeContract({
      address: ROUTER_ADDRESS as `0x${string}`,
      abi: RouterAbi.abi,
      functionName: 'swapExactTokensForTokens',
      args: [
        parseEther(amountIn),
        minOut,
        route as `0x${string}`[],// 例如：['0xTKA', '0xTKB', '0xTKC']
        address as `0x${string}`,
        BigInt(Math.floor(Date.now() / 1000) + 1200),// 如果交易在 20 分钟内没有被确认，自动过期
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
// 用户输入了金额，且查询到了授权额度，授权额度 < 需要转账的金额的情况下必须需要授权
  const needsApproval = !!amountIn && !!allowance && (allowance as bigint) < parseEther(amountIn || '0')

  const { writeContract: approve, isPending: isApproving } = useWriteContract()

  const handleApprove = () => {
    approve({
      address: tokenIn as `0x${string}`,
      abi: ERC20Abi.abi,
      functionName: 'approve',
      args: [ROUTER_ADDRESS as `0x${string}`, maxUint256],  // 	只需授权一次maxUint256授权多少（无限额度）
      chainId: sepolia.id,
    })
  }
// 获取输入和输出代币符号。 TOKENS.find() - 在代币列表中查找， 匹配代币地址
  const tokenInSymbol = TOKENS.find(t => t.address === tokenIn)?.symbol || '???'
  const tokenOutSymbol = TOKENS.find(t => t.address === tokenOut)?.symbol || '???'
  // 遍历路由数组的每个地址，匹配对应符号，提升了用户体验UI好
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
