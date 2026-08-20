'use client'

import { useState, useEffect } from 'react'
import { useAccount, useWriteContract, useReadContract } from 'wagmi'
import { parseEther, formatEther, maxUint256 } from 'viem'
import { sepolia } from 'wagmi/chains'
import RouterAbi from '@/abis/DefiRouter.json'
import DefiPairAbi from '@/abis/DefiPair.json'
import ERC20Abi from '@/abis/TestToken.json'
import { ROUTER_ADDRESS, TOKEN_A_ADDRESS, TOKEN_B_ADDRESS, FACTORY_ADDRESS } from '@/lib/wagmi'
import { getLiquidityAmount, getRemoveAmounts, getPoolShare, formatAmount } from '@/lib/utils'
import { fetchUserStats } from '@/lib/subgraph'

export default function PoolPage() {
  const { address, isConnected } = useAccount()

  // 添加流动性
  const [amountA, setAmountA] = useState('')
  const [amountB, setAmountB] = useState('')
  const [activeTab, setActiveTab] = useState<'add' | 'remove'>('add')

  // 移除流动性
  const [removeLp, setRemoveLp] = useState('')
  const [removePercent, setRemovePercent] = useState(0)

  // 读取交易对信息
  const { data: pairAddress } = useReadContract({
    address: FACTORY_ADDRESS as `0x${string}`,
    abi: [{ inputs: [{ name: 'a', type: 'address' }, { name: 'b', type: 'address' }], name: 'getPair', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' }],
    functionName: 'getPair',
    args: [TOKEN_A_ADDRESS as `0x${string}`, TOKEN_B_ADDRESS as `0x${string}`],
    chainId: sepolia.id,
  })

  const pairExists = !!pairAddress && pairAddress !== '0x0000000000000000000000000000000000000000'

  // 定时（每8秒）自动查询交易对的储备量和 LP Token 总供应量，保持 UI 数据与链上同步。
  const { data: reserves, refetch: refetchReserves } = useReadContract({
    address: pairAddress as `0x${string}` | undefined,
    abi: DefiPairAbi.abi,
    functionName: 'getReserves',
    chainId: sepolia.id,
    query: { enabled: pairExists, refetchInterval: 8000 },
  })

  const { data: totalSupply, refetch: refetchTotalSupply } = useReadContract({
    address: pairAddress as `0x${string}` | undefined,
    abi: DefiPairAbi.abi,
    functionName: 'totalSupply',
    chainId: sepolia.id,
    query: { enabled: pairExists, refetchInterval: 8000 },
  })

  // 读取 用户的 LP 余额
  const { data: lpBalance, refetch: refetchLpBalance } = useReadContract({
    address: pairAddress as `0x${string}` | undefined,
    abi: DefiPairAbi.abi,
    functionName: 'balanceOf',
    args: [address as `0x${string}`],
    chainId: sepolia.id,
    query: { enabled: !!address && pairExists, refetchInterval: 8000 },
  })

  // 类型转换：
  const reservesData = reserves as [bigint, bigint, number] | undefined
  // 所有 LP Token 的总数量
  const totalSupplyData = totalSupply as bigint | undefined
  const userLpBalance = lpBalance as bigint | undefined

  // 提取原始值避免数组引用导致无限重算，否则在 useEffect 中可能导致无限循环
  // const reserve0 = reservesData?.[0]  // 如果这样每次都是新的引用
  const reserve0 = reservesData?.[0]// 值相同则引用相同
  const reserve1 = reservesData?.[1]

  const poolShare = userLpBalance && totalSupplyData
    ? getPoolShare(userLpBalance, totalSupplyData)
    : 0

  // LP 手续费收入（从子图读取）
  const [feesToken0, setFeesToken0] = useState('0')
  const [feesToken1, setFeesToken1] = useState('0')

  useEffect(() => {
    if (!address) return
    // 用户连接时查询收益
    fetchUserStats(address).then(data => {
      if (data.userStats) {
        setFeesToken0(data.userStats.totalFeesEarnedToken0 || '0')
        setFeesToken1(data.userStats.totalFeesEarnedToken1 || '0')
      }
    }).catch(() => {})
  }, [address])  // 只在地址变化时执行

  // 计算将获得的 LP Token
  const [estimatedLp, setEstimatedLp] = useState('')  // 预估获得的 LP Token
  const [estimatedShare, setEstimatedShare] = useState(0)// 预估份额百分比

  useEffect(() => {
     // 检查条件：必须有储备量、用户输入了金额、有总供应量
    if (!reserve0 || !reserve1 || !amountA || !amountB || !totalSupplyData) return
    try {
         // 计算会获得多少 LP Token
      const lp = getLiquidityAmount(
        parseEther(amountA),
        parseEther(amountB),
        reserve0,
        reserve1,
        totalSupplyData
      )
      const totalAfter = totalSupplyData + lp
      setEstimatedLp(formatEther(lp))
      setEstimatedShare(getPoolShare(lp, totalAfter))
    } catch {
      setEstimatedLp('')
      setEstimatedShare(0)
    }
  }, [amountA, amountB, reserve0, reserve1, totalSupplyData])

  // 计算移除将获得的代币
  const [removeAmounts, setRemoveAmounts] = useState<{ amount0: string; amount1: string }>({ amount0: '', amount1: '' })

  useEffect(() => {
    if (!reserve0 || !reserve1 || !removeLp || !totalSupplyData) return
    try {
      const amounts = getRemoveAmounts(
        parseEther(removeLp),
        reserve0,
        reserve1,
        totalSupplyData
      )
      setRemoveAmounts({
        amount0: formatEther(amounts.amount0),
        amount1: formatEther(amounts.amount1),
      })
    } catch {
      setRemoveAmounts({ amount0: '', amount1: '' })
    }
  }, [removeLp, reserve0, reserve1, totalSupplyData])

  // 拆开 useWriteContract，每个操作独立 isPending，避免互相影响
  const { writeContract: approveA, isPending: isApprovingA } = useWriteContract()
  const { writeContract: approveB, isPending: isApprovingB } = useWriteContract()
  const { writeContract: approveLp, isPending: isApprovingLp } = useWriteContract()
  const { writeContract: addLiquidity, isPending: isAdding, isSuccess: isAddSuccess } = useWriteContract()
  const { writeContract: removeLiquidity, isPending: isRemoving, isSuccess: isRemoveSuccess } = useWriteContract()

  // 交易成功后延迟刷新数据（等链上确认）
  useEffect(() => {
    if (!isAddSuccess && !isRemoveSuccess) return
    const timer = setTimeout(() => {
      refetchReserves()
      refetchTotalSupply()
      refetchLpBalance()
    }, 3000)
    return () => clearTimeout(timer)
  }, [isAddSuccess, isRemoveSuccess, refetchReserves, refetchTotalSupply, refetchLpBalance])

  const handleAddLiquidity = () => {
    if (!amountA || !amountB || !address || isAdding) return
    addLiquidity({
      address: ROUTER_ADDRESS as `0x${string}`,
      abi: RouterAbi.abi,
      functionName: 'addLiquidity',
      args: [
        TOKEN_A_ADDRESS as `0x${string}`,
        TOKEN_B_ADDRESS as `0x${string}`,
        parseEther(amountA),
        parseEther(amountB),
        0n, 0n,
        address as `0x${string}`,
        BigInt(Math.floor(Date.now() / 1000) + 1200),
      ],
      chainId: sepolia.id,
    })
  }

  const handleRemoveLiquidity = () => {
    if (!removeLp || !address || isRemoving) return
    removeLiquidity({
      address: ROUTER_ADDRESS as `0x${string}`,
      abi: RouterAbi.abi,
      functionName: 'removeLiquidity',
      args: [
        TOKEN_A_ADDRESS as `0x${string}`,
        TOKEN_B_ADDRESS as `0x${string}`,
        parseEther(removeLp),
        0n, 0n,
        address as `0x${string}`,
        BigInt(Math.floor(Date.now() / 1000) + 1200),
      ],
      chainId: sepolia.id,
    })
  }

  const handleApproveA = () => {
    if (isApprovingA) return
    approveA({
      address: TOKEN_A_ADDRESS as `0x${string}`,
      abi: ERC20Abi.abi,
      functionName: 'approve',
      args: [ROUTER_ADDRESS as `0x${string}`, maxUint256],
      chainId: sepolia.id,
    })
  }

  const handleApproveB = () => {
    if (isApprovingB) return
    approveB({
      address: TOKEN_B_ADDRESS as `0x${string}`,
      abi: ERC20Abi.abi,
      functionName: 'approve',
      args: [ROUTER_ADDRESS as `0x${string}`, maxUint256],
      chainId: sepolia.id,
    })
  }

  // 授权 LP Token（移除流动性前必须授权）
  const handleApproveLp = () => {
    if (isApprovingLp || !pairAddress) return
    approveLp({
      address: pairAddress as `0x${string}`,
      abi: DefiPairAbi.abi,
      functionName: 'approve',
      args: [ROUTER_ADDRESS as `0x${string}`, maxUint256],
      chainId: sepolia.id,
    })
  }

  if (!isConnected) {
    return (
      <div className="max-w-md mx-auto mt-20 text-center">
        <h2 className="text-xl font-semibold mb-3">请连接钱包</h2>
        <p className="text-[var(--muted-foreground)]">使用 MetaMask 或 WalletConnect 连接钱包以管理流动性</p>
      </div>
    )
  }

  return (
    <div className="max-w-md mx-auto space-y-6">
      {/* 池子信息 */}
      {pairExists && reservesData && (
        <div className="bg-[var(--card)] border border-[var(--card-border)] rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-3">TKA/TKB 流动性池</h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-[var(--muted-foreground)]">TKA 储备</div>
              <div className="font-medium">{formatAmount(reservesData[0])}</div>
            </div>
            <div>
              <div className="text-[var(--muted-foreground)]">TKB 储备</div>
              <div className="font-medium">{formatAmount(reservesData[1])}</div>
            </div>
            <div>
              <div className="text-[var(--muted-foreground)]">我的 LP</div>
              <div className="font-medium">{userLpBalance ? formatAmount(userLpBalance) : '0'}</div>
            </div>
            <div>
              <div className="text-[var(--muted-foreground)]">池子占比</div>
              <div className="font-medium">{poolShare.toFixed(4)}%</div>
            </div>
            <div>
              <div className="text-[var(--muted-foreground)]">手续费收入 TKA</div>
              <div className="font-medium text-green-600">{Number(feesToken0).toFixed(6)}</div>
            </div>
            <div>
              <div className="text-[var(--muted-foreground)]">手续费收入 TKB</div>
              <div className="font-medium text-green-600">{Number(feesToken1).toFixed(6)}</div>
            </div>
          </div>
        </div>
      )}

      {/* 添加/移除 Tab */}
      <div className="bg-[var(--card)] border border-[var(--card-border)] rounded-xl overflow-hidden">
        <div className="flex border-b border-[var(--card-border)]">
          <button
            onClick={() => setActiveTab('add')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === 'add'
                ? 'text-indigo-600 border-b-2 border-indigo-600'
                : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
            }`}
          >
            添加流动性
          </button>
          <button
            onClick={() => setActiveTab('remove')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === 'remove'
                ? 'text-indigo-600 border-b-2 border-indigo-600'
                : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
            }`}
          >
            移除流动性
          </button>
        </div>

        {activeTab === 'add' ? (
          <div className="p-6 space-y-4">
            <div className="space-y-2">
              <label className="text-sm text-[var(--muted-foreground)]">TKA 数量</label>
              <input
                type="number"
                placeholder="0.0"
                value={amountA}
                onChange={(e) => setAmountA(e.target.value)}
                className="w-full p-3 bg-[var(--muted)] rounded-lg border border-[var(--card-border)] outline-none"
              />
            </div>
            <div className="flex justify-center">
              <span className="text-lg">+</span>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-[var(--muted-foreground)]">TKB 数量</label>
              <input
                type="number"
                placeholder="0.0"
                value={amountB}
                onChange={(e) => setAmountB(e.target.value)}
                className="w-full p-3 bg-[var(--muted)] rounded-lg border border-[var(--card-border)] outline-none"
              />
            </div>

            {/* 预估 LP */}
            {estimatedLp && (
              <div className="bg-[var(--muted)] rounded-lg p-3 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-[var(--muted-foreground)]">你将获得</span>
                  <span className="font-medium">{estimatedLp.slice(0, 10)} LP Token</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--muted-foreground)]">占池子比例</span>
                  <span className="font-medium">{estimatedShare.toFixed(4)}%</span>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={handleApproveA}
                disabled={isApprovingA}
                className={`flex-1 py-2.5 text-sm border border-[var(--card-border)] rounded-lg transition-colors ${
                  isApprovingA ? 'opacity-50 cursor-not-allowed' : 'hover:bg-[var(--muted)]'
                }`}
              >
                {isApprovingA ? '授权中...' : '授权 TKA'}
              </button>
              <button
                onClick={handleApproveB}
                disabled={isApprovingB}
                className={`flex-1 py-2.5 text-sm border border-[var(--card-border)] rounded-lg transition-colors ${
                  isApprovingB ? 'opacity-50 cursor-not-allowed' : 'hover:bg-[var(--muted)]'
                }`}
              >
                {isApprovingB ? '授权中...' : '授权 TKB'}
              </button>
            </div>

            <button
              onClick={handleAddLiquidity}
              disabled={!amountA || !amountB || isAdding}
              className={`w-full py-3 rounded-lg font-medium transition-colors ${
                !amountA || !amountB || isAdding
                  ? 'bg-gray-400 text-white cursor-not-allowed'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700'
              }`}
            >
              {isAdding ? '交易中...' : '添加流动性'}
            </button>
          </div>
        ) : (
          <div className="p-6 space-y-4">
            {/* 快捷比例选择 */}
            <div className="flex gap-2">
              {[25, 50, 75, 100].map((pct) => (
                <button
                  key={pct}
                  onClick={() => {
                    if (userLpBalance) {
                      setRemoveLp(formatEther(userLpBalance * BigInt(pct) / 100n))
                      setRemovePercent(pct)
                    }
                  }}
                  className={`flex-1 py-1.5 text-xs rounded-lg border transition-colors ${
                    removePercent === pct
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'border-[var(--card-border)] text-[var(--muted-foreground)] hover:bg-[var(--muted)]'
                  }`}
                >
                  {pct}%
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <label className="text-sm text-[var(--muted-foreground)]">LP Token 数量</label>
              <input
                type="number"
                placeholder="0.0"
                value={removeLp}
                onChange={(e) => {
                  setRemoveLp(e.target.value)
                  setRemovePercent(0)
                }}
                className="w-full p-3 bg-[var(--muted)] rounded-lg border border-[var(--card-border)] outline-none"
              />
              {userLpBalance && (
                <div className="text-xs text-[var(--muted-foreground)]">
                  余额: {formatAmount(userLpBalance)}
                </div>
              )}
            </div>

            {/* 将取回的数量 */}
            {removeAmounts.amount0 && (
              <div className="bg-[var(--muted)] rounded-lg p-3 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-[var(--muted-foreground)]">将取回 TKA</span>
                  <span className="font-medium">{removeAmounts.amount0.slice(0, 10)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--muted-foreground)]">将取回 TKB</span>
                  <span className="font-medium">{removeAmounts.amount1.slice(0, 10)}</span>
                </div>
              </div>
            )}

            {/* 授权 LP Token */}
            <button
              onClick={handleApproveLp}
              disabled={isApprovingLp}
              className={`w-full py-2.5 text-sm border border-[var(--card-border)] rounded-lg transition-colors ${
                isApprovingLp ? 'opacity-50 cursor-not-allowed' : 'hover:bg-[var(--muted)]'
              }`}
            >
              {isApprovingLp ? '授权中...' : '授权 LP Token'}
            </button>

            <button
              onClick={handleRemoveLiquidity}
              disabled={!removeLp || !pairExists || isRemoving}
              className={`w-full py-3 rounded-lg font-medium transition-colors ${
                !removeLp || !pairExists || isRemoving
                  ? 'bg-gray-400 text-white cursor-not-allowed'
                  : 'bg-red-600 text-white hover:bg-red-700'
              }`}
            >
              {isRemoving ? '交易中...' : '移除流动性'}
            </button>
            <p className="text-xs text-[var(--muted-foreground)] text-center">
              首次移除需先授权 Router 操作 LP Token
            </p>
          </div>
        )}
      </div>
    </div>
  )
}