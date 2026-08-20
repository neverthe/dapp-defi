# dapp-defi

基于 Uniswap V2 架构的去中心化交易所 (DEX) 全栈项目，实现 AMM 恒定乘积做市模型 (x * y = k)。

## 功能特性

- **代币兑换**：支持单跳和多跳路由的代币兑换，含滑点保护
- **流动性管理**：添加/移除流动性，按比例自动计算最优添加量
- **交易对详情**：实时查看储备量、交易量、手续费、价格曲线
- **TWAP 预言机**：时间加权平均价格，防价格操纵
- **Flash Swap**：支持闪电兑换回调
- **The Graph 子图**：链上数据索引，快速查询交易历史和用户统计
- **暗色主题**：支持亮色/暗色主题切换

## 技术栈

| 层次 | 技术 |
|------|------|
| 智能合约 | Solidity 0.8.28 + OpenZeppelin 5.6 |
| 合约框架 | Hardhat 3 |
| 前端 | Next.js 16 (App Router) + React 19 + TypeScript |
| Web3 | Wagmi 3 + Viem 2 |
| 样式 | Tailwind CSS 4 |
| 钱包 | MetaMask + WalletConnect |
| 数据索引 | The Graph |
| 图表 | Recharts |
| 测试网 | Sepolia |

## 项目结构

```
dapp-defi/
├── contracts/                # Solidity 智能合约
│   ├── DefiFactory.sol       # 工厂合约，CREATE2 部署交易对
│   ├── DefiPair.sol          # AMM 交易对核心合约
│   ├── DefiRouter.sol        # 路由合约，swap + 流动性
│   └── TestToken.sol         # 测试 ERC20 代币
├── scripts/                  # 部署和运维脚本
├── src/                      # Next.js 前端
│   ├── app/                  # 页面路由
│   │   ├── page.tsx          # 首页 - 交易对列表
│   │   ├── swap/page.tsx     # 代币兑换
│   │   ├── pool/page.tsx     # 流动性管理
│   │   └── pair/[address]/   # 交易对详情
│   ├── components/           # 共享组件
│   ├── abis/                 # 合约 ABI
│   └── lib/                  # 工具库 (AMM 公式 / 子图查询)
├── subgraph/                 # The Graph 子图
├── test/                     # 合约测试
└── hardhat.config.js         # Hardhat 配置
```

## 智能合约

### DefiFactory
工厂合约，使用 CREATE2 确定性部署交易对。
- `createPair(tokenA, tokenB)` — 创建新交易对
- `getPair(tokenA, tokenB)` — 查询交易对地址
- `allPairs` / `allPairsLength()` — 遍历所有交易对
- `pairFor(tokenA, tokenB)` — 预计算 CREATE2 地址

### DefiPair
AMM 交易对核心，继承 ERC20（LP Token 即合约本身）。
- **恒定乘积**：x * y = k
- **手续费**：0.3%（`amountIn * 997 / 1000`）
- **TWAP**：UQ112x112 定点数累积价格
- `mint(to)` / `burn(to)` — 添加/移除流动性
- `swap(amount0Out, amount1Out, to, data)` — 代币兑换，支持 flash swap
- `sync()` / `skim(to)` — 储备量同步

### DefiRouter
路由合约，封装 swap 和流动性操作，支持多跳路由。
- `swapExactTokensForTokens` — 确定输入，最少输出
- `swapTokensForExactTokens` — 确定输出，最多输入
- `addLiquidity` / `removeLiquidity` — 流动性管理
- `getAmountsOut` / `getAmountsIn` — 报价查询

## 快速开始

### 环境要求

- Node.js >= 20
- MetaMask 浏览器扩展

### 安装

```bash
cd dapp-defi
npm install
```

### 配置环境变量

```bash
cp .env.example .env
```

填写以下变量：
- `NEXT_PUBLIC_FACTORY_ADDRESS` — 工厂合约地址
- `NEXT_PUBLIC_ROUTER_ADDRESS` — 路由合约地址
- `NEXT_PUBLIC_TOKEN_A` / `NEXT_PUBLIC_TOKEN_B` / `NEXT_PUBLIC_TOKEN_C` — 代币地址
- `NEXT_PUBLIC_SUBGRAPH_URL` — The Graph 子图端点
- `DEPLOYER_PRIVATE_KEY` — 部署私钥（仅 Hardhat 使用）

### 启动开发服务器

```bash
npm run dev
```

访问 http://localhost:3003

### 编译合约

```bash
npx hardhat compile
```

### 运行测试

```bash
npx hardhat test
```

### 部署到 Sepolia

```bash
npx hardhat run scripts/deploy.js --network sepolia
```

## 核心公式

**Swap 输出计算**：
```
amountOut = amountIn * 997 * reserveOut / (reserveIn * 1000 + amountIn * 997)
```

**添加流动性**（首次）：
```
liquidity = sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY
```

**添加流动性**（非首次）：
```
liquidity = min(amount0 * totalSupply / reserve0, amount1 * totalSupply / reserve1)
```

## License

MIT