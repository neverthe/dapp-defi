/**
 * AMM 工具函数
 * 面试要点：能解释 x × y = k 恒定乘积公式
 */

// 计算 swap 输出（扣除 0.3% 手续费）
// 公式：amountOut = amountIn * 997 * reserveOut / (reserveIn * 1000 + amountIn * 997)
export function getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  const amountInWithFee = amountIn * 997n
  const numerator = amountInWithFee * reserveOut
  const denominator = reserveIn * 1000n + amountInWithFee
  return numerator / denominator
}

// 计算 swap 所需输入（给定期望输出）
export function getAmountIn(amountOut: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  const numerator = reserveIn * amountOut * 1000n
  const denominator = (reserveOut - amountOut) * 997n
  return numerator / denominator + 1n
}

// 计算价格（token0 的 token1 价格）
export function getPrice(reserve0: bigint, reserve1: bigint): number {
  if (reserve0 === 0n) return 0
  return Number(reserve1) / Number(reserve0)
}

// 计算价格影响（百分比）
// 价格影响 = amountIn / (reserveIn + amountIn) * 100
export function getPriceImpact(amountIn: bigint, reserveIn: bigint): number {
  if (reserveIn === 0n) return 100
  return Number(amountIn) / (Number(reserveIn) + Number(amountIn)) * 100
}

// 计算滑点容忍下的最小输出
// minAmountOut = amountOut * (1 - slippage%)
export function getMinAmountOut(amountOut: bigint, slippagePercent: number): bigint {
  return amountOut * BigInt(Math.floor(10000 - slippagePercent * 100)) / 10000n
}

// 计算 LP Token 数量（按比例）
export function getLiquidityAmount(
  amount0: bigint,
  amount1: bigint,
  reserve0: bigint,
  reserve1: bigint,
  totalSupply: bigint
): bigint {
  if (totalSupply === 0n) {
    // 首次添加：sqrt(amount0 * amount1)
    return sqrt(amount0 * amount1)
  }
  // 按比例：min(amount0 * totalSupply / reserve0, amount1 * totalSupply / reserve1)
  const lp0 = amount0 * totalSupply / reserve0
  const lp1 = amount1 * totalSupply / reserve1
  return lp0 < lp1 ? lp0 : lp1
}

// 计算移除流动性时取回的代币
export function getRemoveAmounts(
  liquidity: bigint,
  reserve0: bigint,
  reserve1: bigint,
  totalSupply: bigint
): { amount0: bigint; amount1: bigint } {
  return {
    amount0: liquidity * reserve0 / totalSupply,
    amount1: liquidity * reserve1 / totalSupply,
  }
}

// 计算 LP Token 占比
export function getPoolShare(liquidity: bigint, totalSupply: bigint): number {
  if (totalSupply === 0n) return 0
  return Number(liquidity) / Number(totalSupply) * 100
}

// 整数平方根
function sqrt(value: bigint): bigint {
  if (value < 2n) return value
  let z = value
  let x = value / 2n + 1n
  while (x < z) {
    z = x
    x = (value / x + x) / 2n
  }
  return z
}

// 格式化大数（带精度）
export function formatAmount(amount: bigint, decimals: number = 18): string {
  const str = amount.toString().padStart(decimals + 1, '0')
  const intPart = str.slice(0, str.length - decimals) || '0'
  const fracPart = str.slice(str.length - decimals).replace(/0+$/, '')
  return fracPart ? `${intPart}.${fracPart}` : intPart
}

// 解析用户输入为大数（带精度）
export function parseAmount(input: string, decimals: number = 18): bigint {
  const [intPart, fracPart = ''] = input.split('.')
  const padded = fracPart.padEnd(decimals, '0').slice(0, decimals)
  return BigInt(intPart + padded)
}