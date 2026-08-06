const SUBGRAPH_URL = process.env.NEXT_PUBLIC_SUBGRAPH_URL || ''

// 子图查询工具函数
export async function querySubgraph<T = any>(query: string, variables?: Record<string, any>): Promise<T> {
  const res = await fetch(SUBGRAPH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  const json = await res.json()
  if (json.errors) throw new Error(json.errors[0]?.message || 'Subgraph query failed')
  return json.data
}

// 获取所有交易对
export async function fetchPairs() {
  const query = `
    {
      pairs(first: 50, orderBy: createdAtTimestamp, orderDirection: desc) {
        id
        token0 { id symbol name }
        token1 { id symbol name }
        reserve0
        reserve1
        totalSupply
        volumeToken0
        volumeToken1
        feesToken0
        feesToken1
        txCount
      }
    }
  `
  return querySubgraph<{ pairs: any[] }>(query)
}

// 获取单个交易对详情
export async function fetchPair(pairAddress: string) {
  const query = `
    query($id: ID!) {
      pair(id: $id) {
        id
        token0 { id symbol name }
        token1 { id symbol name }
        reserve0
        reserve1
        totalSupply
        volumeToken0
        volumeToken1
        feesToken0
        feesToken1
        txCount
        swaps(first: 10, orderBy: timestamp, orderDirection: desc) {
          id
          amount0In amount0Out
          amount1In amount1Out
          timestamp
          txHash
        }
      }
    }
  `
  return querySubgraph<{ pair: any }>(query, { id: pairAddress.toLowerCase() })
}

// 获取用户统计（含手续费收入）
export async function fetchUserStats(address: string) {
  const query = `
    query($id: ID!) {
      userStats(id: $id) {
        id
        swapCount
        totalVolumeUSD
        totalFeesEarnedToken0
        totalFeesEarnedToken1
        liquidityActions(first: 20, orderBy: timestamp, orderDirection: desc) {
          id
          type
          amount0
          amount1
          liquidity
          pair { id token0 { symbol } token1 { symbol } }
          timestamp
        }
      }
    }
  `
  return querySubgraph<{ userStats: any }>(query, { id: address.toLowerCase() })
}