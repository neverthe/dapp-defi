'use client'

import { useAccount } from 'wagmi'
import { useEffect, useState } from 'react'
import { fetchPairs } from '@/lib/subgraph'
import Link from 'next/link'// Next.js 路由跳转

export default function Home() {
  const { isConnected } = useAccount()
  const [pairs, setPairs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // useEffect 确保在 DOM 渲染完成后获取数据。
    fetchPairs()
      .then((data) => setPairs(data.pairs || []))
      .catch(() => {})
      .finally(() => setLoading(false))
       // 组件挂载后自动获取数据 空依赖数组 = 只在页面加载时执行一次
  }, [])

  return (
    <div className="space-y-8">
      {/* 标题区域 */}
      <div className="text-center py-8">
        <h1 className="text-3xl font-bold mb-3">DeFi Swap</h1>
        <p className="text-[var(--muted-foreground)] max-w-lg mx-auto">
          基于 AMM 恒定乘积模型（x × y = k）的去中心化交易所。
          提供代币兑换、流动性挖矿和 0.3% 手续费收益。
        </p>
      </div>

      {/* 快速操作 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link
          href="/swap"
          className="bg-[var(--card)] border border-[var(--card-border)] rounded-xl p-6 hover:border-indigo-400 transition-colors"
        >
          <h2 className="text-lg font-semibold mb-2">代币兑换</h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            使用 x × y = k 恒定乘积公式进行代币兑换，0.3% 手续费归 LP 持有者
          </p>
        </Link>
        <Link
          href="/pool"
          className="bg-[var(--card)] border border-[var(--card-border)] rounded-xl p-6 hover:border-indigo-400 transition-colors"
        >
          <h2 className="text-lg font-semibold mb-2">流动性池</h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            添加流动性赚取交易手续费，按池子份额获取 LP Token
          </p>
        </Link>
      </div>

      {/* 交易对列表 */}
      <div className="bg-[var(--card)] border border-[var(--card-border)] rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--card-border)]">
          <h2 className="text-lg font-semibold">交易对</h2>
        </div>
        {loading ? (
          <div className="p-6 text-center text-[var(--muted-foreground)]">加载中...</div>
        ) : pairs.length === 0 ? (
          <div className="p-6 text-center text-[var(--muted-foreground)]">
            暂无交易对。请先部署合约并创建流动性池。
          </div>
        ) : (
          <div className="divide-y divide-[var(--card-border)]">
            {pairs.map((pair: any) => (
              <Link
                key={pair.id}
                href={`/pair/${pair.id}`}
                className="flex items-center justify-between px-6 py-4 hover:bg-[var(--muted)] transition-colors"
              >
                <div>
                  <span className="font-medium">
                    {pair.token0.symbol}/{pair.token1.symbol}
                  </span>
                  <span className="text-xs text-[var(--muted-foreground)] ml-2">
                    {pair.txCount} 笔交易
                  </span>
                </div>
                <div className="text-right">
                  <div className="text-sm">
                    储备: {Number(pair.reserve0).toFixed(4)} / {Number(pair.reserve1).toFixed(4)}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}