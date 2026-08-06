'use client'

import { useMemo } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceDot,
  ReferenceLine,
  Label,
} from 'recharts'

interface PriceChartProps {
  reserve0: bigint
  reserve1: bigint
  token0Symbol: string
  token1Symbol: string
}

/**
 * 价格曲线图组件
 * 绘制 x × y = k 的双曲线，标出当前价格点
 * 面试加分项：可视化展示 AMM 恒定乘积
 */
export default function PriceChart({ reserve0, reserve1, token0Symbol, token1Symbol }: PriceChartProps) {
  const k = useMemo(() => {
    const r0 = Number(reserve0) / 1e18
    const r1 = Number(reserve1) / 1e18
    return r0 * r1
  }, [reserve0, reserve1])

  const currentX = useMemo(() => Number(reserve0) / 1e18, [reserve0])
  const currentY = useMemo(() => Number(reserve1) / 1e18, [reserve1])
  const currentPrice = useMemo(() => currentY / currentX, [currentX, currentY])

  // 生成曲线数据点
  const curveData = useMemo(() => {
    const points: { x: number; y: number }[] = []
    const minX = currentX * 0.3
    const maxX = currentX * 3
    const step = (maxX - minX) / 100

    for (let x = minX; x <= maxX; x += step) {
      const y = k / x
      points.push({ x, y })
    }
    return points
  }, [k, currentX])

  // 当前价格切线数据
  const tangentData = useMemo(() => {
    const points: { x: number; y: number }[] = []
    const minX = currentX * 0.5
    const maxX = currentX * 1.5
    const dx = (maxX - minX) / 20

    for (let x = minX; x <= maxX; x += dx) {
      const y = currentY + currentPrice * (x - currentX)
      points.push({ x, y })
    }
    return points
  }, [currentX, currentY, currentPrice])

  const formatX = (v: number) => v.toFixed(1)
  const formatY = (v: number) => v.toFixed(1)

  return (
    <div className="bg-[var(--card)] border border-[var(--card-border)] rounded-xl p-4">
      <h3 className="text-sm font-semibold mb-2">
        x × y = k 恒定乘积曲线 ({token0Symbol}/{token1Symbol})
      </h3>
      <p className="text-xs text-[var(--muted-foreground)] mb-3">
        当前价格: 1 {token0Symbol} = {currentPrice.toFixed(4)} {token1Symbol}
        <span className="ml-2">k = {k.toFixed(2)}</span>
      </p>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" />
          <XAxis
            dataKey="x"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={formatX}
            stroke="var(--muted-foreground)"
            fontSize={11}
            label={{ value: `${token0Symbol} 储备量`, position: 'insideBottom', offset: -5, fontSize: 11 }}
          />
          <YAxis
            dataKey="y"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={formatY}
            stroke="var(--muted-foreground)"
            fontSize={11}
            label={{ value: `${token1Symbol} 储备量`, angle: -90, position: 'insideLeft', fontSize: 11 }}
          />
          <Tooltip
            formatter={(value: number, name: string) => [value.toFixed(4), name === 'x' ? token0Symbol : token1Symbol]}
            contentStyle={{ background: 'var(--card)', border: '1px solid var(--card-border)', borderRadius: '8px', fontSize: '12px' }}
          />

          {/* 恒定乘积曲线 */}
          <Line
            data={curveData}
            dataKey="y"
            stroke="#6366f1"
            strokeWidth={2}
            dot={false}
            name="x × y = k"
          />

          {/* 当前价格点 */}
          <ReferenceDot
            x={currentX}
            y={currentY}
            r={6}
            fill="#f59e0b"
            stroke="#fff"
            strokeWidth={2}
          >
            <Label
              value="当前位置"
              position="top"
              fontSize={11}
              fill="var(--foreground)"
            />
          </ReferenceDot>

          {/* 价格切线 */}
          <Line
            data={tangentData}
            dataKey="y"
            stroke="#f59e0b"
            strokeWidth={1.5}
            strokeDasharray="5 5"
            dot={false}
            name="当前价格线"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}