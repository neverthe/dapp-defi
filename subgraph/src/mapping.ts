import {
  BigInt,
  BigDecimal,
  Bytes,
  Address,
  ethereum,
  log,
  dataSource,
} from "@graphprotocol/graph-ts"
import {
  PairCreated,
} from "../generated/DefiFactory/DefiFactory"
import { ERC20 } from "../generated/DefiFactory/ERC20"
import {
  Swap,
  Mint,
  Burn,
  Sync,
} from "../generated/templates/DefiPair/DefiPair"
import { DefiPair as DefiPairTemplate } from "../generated/templates"
import {
  Factory,
  Pair,
  Token,
  Swap as SwapEntity,
  LiquidityAction,
  UserStats,
} from "../generated/schema"

// 常量
let ZERO_BD = BigDecimal.fromString("0")
let ZERO_BI = BigInt.fromI32(0)
let ONE_BI = BigInt.fromI32(1)

// ── 工厂事件 ──

export function handlePairCreated(event: PairCreated): void {
  // 获取或创建工厂
  let factory = Factory.load("factory")
  if (factory == null) {
    factory = new Factory("factory")
    factory.pairCount = 0
    factory.totalVolumeUSD = ZERO_BD
    factory.totalLiquidityUSD = ZERO_BD
  }
  factory.pairCount = factory.pairCount + 1
  factory.save()

  // 创建交易对实体
  let pair = new Pair(event.params.pair.toHexString())
  pair.token0 = getOrCreateToken(event.params.token0).id
  pair.token1 = getOrCreateToken(event.params.token1).id
  pair.reserve0 = ZERO_BD
  pair.reserve1 = ZERO_BD
  pair.totalSupply = ZERO_BD
  pair.volumeToken0 = ZERO_BD
  pair.volumeToken1 = ZERO_BD
  pair.volumeUSD = ZERO_BD
  pair.feesToken0 = ZERO_BD
  pair.feesToken1 = ZERO_BD
  pair.txCount = 0
  pair.createdAtTimestamp = event.block.timestamp
  pair.createdAtBlockNumber = event.block.number
  pair.save()

  // 开始监听该交易对的事件
  DefiPairTemplate.create(event.params.pair)
}

// ── 获取或创建代币 ──
function getOrCreateToken(address: Bytes): Token {
  let id = address.toHexString()
  let token = Token.load(id)
  if (token == null) {
    token = new Token(id)
  }
  // 始终从链上读取 ERC20 元数据（避免首次创建时为空）
  let erc20 = ERC20.bind(Address.fromBytes(address))
  let nameResult = erc20.try_name()
  let symbolResult = erc20.try_symbol()
  let decimalsResult = erc20.try_decimals()
  token.name = nameResult.reverted ? token.name || "" : nameResult.value
  token.symbol = symbolResult.reverted ? token.symbol || "" : symbolResult.value
  token.decimals = decimalsResult.reverted ? token.decimals : decimalsResult.value as i32
  token.save()
  return token
}

// ── Swap 事件 ──

export function handleSwap(event: Swap): void {
  let pair = Pair.load(event.address.toHexString())
  if (pair == null) return

  pair.txCount = pair.txCount + 1

  let amount0In = toDecimal(event.params.amount0In, 18)
  let amount1In = toDecimal(event.params.amount1In, 18)
  let amount0Out = toDecimal(event.params.amount0Out, 18)
  let amount1Out = toDecimal(event.params.amount1Out, 18)

  // 更新交易量
  pair.volumeToken0 = pair.volumeToken0.plus(amount0In)
  pair.volumeToken1 = pair.volumeToken1.plus(amount1In)

  // 手续费 = 输入 * 0.003（0.3% 的手续费留在池中）
  let fee0 = amount0In.times(BigDecimal.fromString("0.003"))
  let fee1 = amount1In.times(BigDecimal.fromString("0.003"))
  pair.feesToken0 = pair.feesToken0.plus(fee0)
  pair.feesToken1 = pair.feesToken1.plus(fee1)

  pair.save()

  // 创建 Swap 记录
  let swapId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString()
  let swap = new SwapEntity(swapId)
  swap.pair = pair.id
  swap.sender = event.params.sender
  swap.from = event.transaction.from
  swap.amount0In = amount0In
  swap.amount1In = amount1In
  swap.amount0Out = amount0Out
  swap.amount1Out = amount1Out
  swap.to = event.params.to
  swap.timestamp = event.block.timestamp
  swap.txHash = event.transaction.hash
  swap.save()

  // 更新用户统计
  let user = getOrCreateUser(event.transaction.from)
  user.swapCount = user.swapCount + 1
  user.save()
}

// ── Mint 事件（添加流动性） ──

export function handleMint(event: Mint): void {
  let pair = Pair.load(event.address.toHexString())
  if (pair == null) return

  let amount0 = toDecimal(event.params.amount0, 18)
  let amount1 = toDecimal(event.params.amount1, 18)

  // 创建流动性操作记录
  let id = event.transaction.hash.toHexString() + "-" + event.logIndex.toString()
  let action = new LiquidityAction(id)
  action.pair = pair.id
  action.type = "Mint"
  action.sender = event.params.sender
  action.user = getOrCreateUser(event.params.sender).id
  action.amount0 = amount0
  action.amount1 = amount1
  action.liquidity = ZERO_BD // 从事件中无法直接获取
  action.timestamp = event.block.timestamp
  action.txHash = event.transaction.hash
  action.save()

  // 更新用户统计
  let user = getOrCreateUser(event.params.sender)
  user.save()
}

// ── Burn 事件（移除流动性） ──

export function handleBurn(event: Burn): void {
  let pair = Pair.load(event.address.toHexString())
  if (pair == null) return

  let amount0 = toDecimal(event.params.amount0, 18)
  let amount1 = toDecimal(event.params.amount1, 18)

  let id = event.transaction.hash.toHexString() + "-" + event.logIndex.toString()
  let action = new LiquidityAction(id)
  action.pair = pair.id
  action.type = "Burn"
  action.sender = event.params.sender
  action.user = getOrCreateUser(event.params.sender).id
  action.amount0 = amount0
  action.amount1 = amount1
  action.liquidity = ZERO_BD
  action.timestamp = event.block.timestamp
  action.txHash = event.transaction.hash
  action.save()

  let user = getOrCreateUser(event.params.sender)
  user.save()
}

// ── Sync 事件（更新储备量） ──

export function handleSync(event: Sync): void {
  let pair = Pair.load(event.address.toHexString())
  if (pair == null) return

  pair.reserve0 = toDecimal(event.params.reserve0, 18)
  pair.reserve1 = toDecimal(event.params.reserve1, 18)
  pair.save()
}

// ── 辅助函数 ──

function getOrCreateUser(address: Bytes): UserStats {
  let id = address.toHexString()
  let user = UserStats.load(id)
  if (user == null) {
    user = new UserStats(id)
    user.swapCount = 0
    user.totalVolumeUSD = ZERO_BD
    user.totalFeesEarnedToken0 = ZERO_BD
    user.totalFeesEarnedToken1 = ZERO_BD
    user.save()
  }
  return user
}

function toDecimal(value: BigInt, decimals: i32): BigDecimal {
  let divisor = BigInt.fromI32(10).pow(decimals as u8)
  let integerPart = value.div(divisor)
  let fractionalPart = value.mod(divisor)
  return BigDecimal.fromString(
    integerPart.toString() + "." + fractionalPart.toString().padStart(decimals as u8, "0")
  )
}