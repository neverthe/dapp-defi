'use client'

import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { fetchPair } from '@/lib/subgraph'
import PriceChart from '@/components/PriceChart'
import { parseEther } from 'viem'

export default function PairDetailPage() {
  const params = useParams()
  const address = params.address as string
  const [pair, setPair] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchPair(address)
      .then((data) => setPair(data.pair))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [address])

  if (loading) {
    return (
      <div className="text-center py-12 text-[var(--muted-foreground)]">加载中...</div>
    )
  }

  if (!pair) {
    return (
      <div className="text-center py-12 text-[var(--muted-foreground)]">
        交易对不存在
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="bg-[var(--card)] border border-[var(--card-border)] rounded-xl p-6">
        <h1 className="text-xl font-bold mb-4">
          {pair.token0.symbol}/{pair.token1.symbol} 交易对
        </h1>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-[var(--muted-foreground)]">储备量 ({pair.token0.symbol})</div>
            <div className="font-medium">{Number(pair.reserve0).toFixed(4)}</div>
          </div>
          <div>
            <div className="text-[var(--muted-foreground)]">储备量 ({pair.token1.symbol})</div>
            <div className="font-medium">{Number(pair.reserve1).toFixed(4)}</div>
          </div>
          <div>
            <div className="text-[var(--muted-foreground)]">LP 总供应量</div>
            <div className="font-medium">{Number(pair.totalSupply).toFixed(4)}</div>
          </div>
          <div>
            <div className="text-[var(--muted-foreground)]">交易次数</div>
            <div className="font-medium">{pair.txCount}</div>
          </div>
          <div>
            <div className="text-[var(--muted-foreground)]">交易量 ({pair.token0.symbol})</div>
            <div className="font-medium">{Number(pair.volumeToken0).toFixed(4)}</div>
          </div>
          <div>
            <div className="text-[var(--muted-foreground)]">交易量 ({pair.token1.symbol})</div>
            <div className="font-medium">{Number(pair.volumeToken1).toFixed(4)}</div>
          </div>
          <div>
            <div className="text-[var(--muted-foreground)]">手续费 ({pair.token0.symbol})</div>
            <div className="font-medium">{Number(pair.feesToken0).toFixed(6)}</div>
          </div>
          <div>
            <div className="text-[var(--muted-foreground)]">手续费 ({pair.token1.symbol})</div>
            <div className="font-medium">{Number(pair.feesToken1).toFixed(6)}</div>
          </div>
        </div>
      </div>

      {/* 价格曲线图 */}
      <PriceChart
        reserve0={parseEther(pair.reserve0)}
        reserve1={parseEther(pair.reserve1)}
        token0Symbol={pair.token0.symbol}
        token1Symbol={pair.token1.symbol}
      />

      {/* 最近交易 */}
      {pair.swaps && pair.swaps.length > 0 && (
        <div className="bg-[var(--card)] border border-[var(--card-border)] rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-[var(--card-border)]">
            <h2 className="text-lg font-semibold">最近交易</h2>
          </div>
          <div className="divide-y divide-[var(--card-border)]">
            {pair.swaps.map((swap: any) => (
              <div key={swap.id} className="px-6 py-3 flex items-center justify-between text-sm">
                <div className="text-[var(--muted-foreground)]">
                  {swap.amount0In > 0
                    ? `+${Number(swap.amount0In).toFixed(4)} ${pair.token0.symbol}`
                    : `-${Number(swap.amount0Out).toFixed(4)} ${pair.token0.symbol}`}
                  {' / '}
                  {swap.amount1In > 0
                    ? `+${Number(swap.amount1In).toFixed(4)} ${pair.token1.symbol}`
                    : `-${Number(swap.amount1Out).toFixed(4)} ${pair.token1.symbol}`}
                </div>
                <div className="text-xs text-[var(--muted-foreground)]">
                  {new Date(Number(swap.timestamp) * 1000).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}