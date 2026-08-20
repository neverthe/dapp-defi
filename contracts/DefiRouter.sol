// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./DefiPair.sol";
import "./DefiFactory.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title DefiRouter
 * @notice 路由合约，封装 swap 和流动性操作
 * 
 * 功能：
 * - swapExactTokensForTokens：输入确定数量，输出最少数量（滑点保护）
 * - swapTokensForExactTokens：输出确定数量，输入最多数量
 * - addLiquidity：添加流动性（自动计算最优比例）
 * - removeLiquidity：移除流动性
 * - 多池路由：A→B→C（面试加分项：Uniswap multihop swap 原理）
 * 
 * 面试要点：
 * - minAmountOut 防止 MEV 抢跑和三明治攻击，
 能够控制交易风险 ，用户指定最小输出金额，实际输出必须 >= 用户指定的最小值
 
 * - 多池路由：当 A/C 没有直接交易对时，通过 A/B 和 B/C 两个池子跳转
 */
contract DefiRouter {
    DefiFactory public immutable factory;

//  构造函数，部署时执行一次  将传入的工厂合约地址赋值给 factory
    constructor(address _factory) {
        factory = DefiFactory(_factory);
    }

    // ── 修饰器 ──
    modifier ensure(uint256 deadline) {
        require(deadline >= block.timestamp, "DefiRouter: EXPIRED");
        _;
    }

    // 接收 ETH（用于 ETH 交易对）
    receive() external payable {}

    // ── 内部函数 ──
    // pure: 不读取也不修改状态变量   internal: 仅合约内部和继承合约可调用
    /// @notice 根据输入和储备量计算输出（已扣除 0.3% 手续费）
    /// 公式：amountOut = amountIn * 997 * reserveOut / (reserveIn * 1000 + amountIn * 997)
    function _getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut)
        internal pure returns (uint256 amountOut)
    {
        require(amountIn > 0, "DefiRouter: INSUFFICIENT_INPUT_AMOUNT");
        require(reserveIn > 0 && reserveOut > 0, "DefiRouter: INSUFFICIENT_LIQUIDITY");

        uint256 amountInWithFee = amountIn * 997;
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = reserveIn * 1000 + amountInWithFee;
        // 这是 Uniswap V2 的恒定乘积公式变体
        amountOut = numerator / denominator;
    }

    /// @notice 根据期望输出和储备量计算所需输入
    /// 公式：amountIn = reserveIn * amountOut * 1000 / ((reserveOut - amountOut) * 997) + 1
    function _getAmountIn(uint256 amountOut, uint256 reserveIn, uint256 reserveOut)
        internal pure returns (uint256 amountIn)
    {
        require(amountOut > 0, "DefiRouter: INSUFFICIENT_OUTPUT_AMOUNT");
        require(reserveIn > 0 && reserveOut > 0, "DefiRouter: INSUFFICIENT_LIQUIDITY");
        require(amountOut < reserveOut, "DefiRouter: INSUFFICIENT_LIQUIDITY");

        uint256 numerator = reserveIn * amountOut * 1000;
        uint256 denominator = (reserveOut - amountOut) * 997;
        // +1: 处理整除舍入误差，确保输入足够
        amountIn = numerator / denominator + 1;
    }

    /// @notice 多池路由：计算路径上每一步的输出
    // path: 代币地址数组，如 [USDC, WETH, DAI]
    function _getAmountsOut(uint256 amountIn, address[] memory path)
        internal view returns (uint256[] memory amounts)
    {
        require(path.length >= 2, "DefiRouter: INVALID_PATH");
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        // 实现 多跳路由：A→B→C 通过两个池子
        for (uint256 i = 0; i < path.length - 1; i++) {
            (uint256 reserveIn, uint256 reserveOut) = _getReserves(path[i], path[i + 1]);
            amounts[i + 1] = _getAmountOut(amounts[i], reserveIn, reserveOut);
        }
    }

    /// @notice 获取交易对的储备量（排序后返回）
    function _getReserves(address tokenA, address tokenB)
        internal view returns (uint256 reserveA, uint256 reserveB)
    {
        (address token0,) = _sortTokens(tokenA, tokenB);
        address pair = factory.getPair(tokenA, tokenB);
        require(pair != address(0), "DefiRouter: PAIR_NOT_FOUND");

        (uint112 reserve0, uint112 reserve1,) = DefiPair(pair).getReserves();
        (reserveA, reserveB) = tokenA == token0
            ? (reserve0, reserve1)
            : (reserve1, reserve0);
    }

// 按地址大小排序，确保交易对唯一标识
    function _sortTokens(address tokenA, address tokenB)
        internal pure returns (address token0, address token1)
    {
        require(tokenA != tokenB, "DefiRouter: IDENTICAL_ADDRESSES");
        (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(token0 != address(0), "DefiRouter: ZERO_ADDRESS");
    }

    function _swap(
        uint256[] memory amounts,
        address[] memory path,
        address _to
    ) internal {
        for (uint256 i = 0; i < path.length - 1; i++) {
            (address input, address output) = (path[i], path[i + 1]);
            (address token0,) = _sortTokens(input, output);
            uint256 amountOut = amounts[i + 1];
            (uint256 amount0Out, uint256 amount1Out) = input == token0
                ? (uint256(0), amountOut)
                : (amountOut, uint256(0));

            address to = i < path.length - 2
                ? factory.getPair(output, path[i + 2]) // 中间步骤：发到下一个交易对
                : _to;                                   // 最后一步：发给用户

            address pair = factory.getPair(input, output);
            DefiPair(pair).swap(amount0Out, amount1Out, to, new bytes(0));
        }
    }

    // ── Swap 兑换 ──

    /// @notice 用确定数量的 token 换尽可能多的另一个 token（带滑点保护）
    /// @param amountIn 输入的代币数量
    /// @param amountOutMin 最少期望输出（滑点保护：低于此值 revert）
    /// @param path 兑换路径，例如 [tokenA, tokenB] 或 [tokenA, tokenB, tokenC]
    /// @param to 接收地址
    /// @param deadline 交易截止时间
    /// @return amounts 每一步的输出数量
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external ensure(deadline) returns (uint256[] memory amounts) {
        // 计算整个路径的预期输出
        amounts = _getAmountsOut(amountIn, path);

        // 滑点保护：最终输出必须 >= 用户期望的最小值
        require(
            amounts[amounts.length - 1] >= amountOutMin,
            "DefiRouter: INSUFFICIENT_OUTPUT_AMOUNT"
        );

        // 从用户转走输入代币到第一个交易对
        _safeTransferFrom(
            path[0],
            msg.sender,
            factory.getPair(path[0], path[1]),
            amounts[0]
        );

        _swap(amounts, path, to);
    }

    /// @notice 用尽可能少的 token 换确定数量的另一个 token
    /// @param amountOut 期望的精确输出
    /// @param amountInMax 最多愿意输入的代币数量（滑点保护）
    /// @param path 兑换路径
    /// @param to 接收地址
    /// @param deadline 交易截止时间
    function swapTokensForExactTokens(
        uint256 amountOut,
        uint256 amountInMax,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external ensure(deadline) returns (uint256[] memory amounts) {
        amounts = new uint256[](path.length);
        amounts[amounts.length - 1] = amountOut;

        // 反向计算每一步所需输入
        for (uint256 i = path.length - 1; i > 0; i--) {
            (uint256 reserveIn, uint256 reserveOut) = _getReserves(path[i - 1], path[i]);
            amounts[i - 1] = _getAmountIn(amounts[i], reserveIn, reserveOut);
        }

        require(amounts[0] <= amountInMax, "DefiRouter: EXCESSIVE_INPUT_AMOUNT");

        _safeTransferFrom(
            path[0],
            msg.sender,
            factory.getPair(path[0], path[1]),
            amounts[0]
        );

        _swap(amounts, path, to);
    }

    // ── 流动性操作 ──

    /// @notice 添加流动性
    /// @param tokenA 代币A地址
    /// @param tokenB 代币B地址
    /// @param amountADesired 期望添加的 tokenA 数量
    /// @param amountBDesired 期望添加的 tokenB 数量
    /// @param amountAMin 最小 tokenA（滑点保护）
    /// @param amountBMin 最小 tokenB（滑点保护）
    /// @param to LP Token 接收地址
    /// @param deadline 截止时间
    /// @return amountA 实际添加的 tokenA 数量
    /// @return amountB 实际添加的 tokenB 数量
    /// @return liquidity 铸造的 LP Token 数量
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    )
        external
        ensure(deadline)
        returns (uint256 amountA, uint256 amountB, uint256 liquidity)
    {
        address pair = factory.getPair(tokenA, tokenB);
        if (pair == address(0)) {
            // 池不存在，直接以期望值创建
            amountA = amountADesired;
            amountB = amountBDesired;
        } else {
            (uint256 reserveA, uint256 reserveB) = _getReserves(tokenA, tokenB);
            if (reserveA == 0 && reserveB == 0) {
                // 池已创建但无流动性（首次添加）
                amountA = amountADesired;
                amountB = amountBDesired;
            } else {
                // 按当前比例计算最优添加量
                uint256 amountBOptimal = _quote(amountADesired, reserveA, reserveB);
                if (amountBOptimal <= amountBDesired) {
                    require(amountBOptimal >= amountBMin, "DefiRouter: INSUFFICIENT_B_AMOUNT");
                    amountA = amountADesired;
                    amountB = amountBOptimal;
                } else {
                    uint256 amountAOptimal = _quote(amountBDesired, reserveB, reserveA);
                    require(amountAOptimal <= amountADesired, "DefiRouter: EXCESSIVE_A_AMOUNT");
                    require(amountAOptimal >= amountAMin, "DefiRouter: INSUFFICIENT_A_AMOUNT");
                    amountA = amountAOptimal;
                    amountB = amountBDesired;
                }
            }
        }

        _safeTransferFrom(tokenA, msg.sender, pair, amountA);
        _safeTransferFrom(tokenB, msg.sender, pair, amountB);

        // 如果池不存在，先创建
        if (pair == address(0)) {
            pair = factory.createPair(tokenA, tokenB);
        }

        liquidity = DefiPair(pair).mint(to);
    }

    /// @notice 移除流动性
    /// @param tokenA 代币A地址
    /// @param tokenB 代币B地址
    /// @param liquidity 要销毁的 LP Token 数量
    /// @param amountAMin 最少取回的 tokenA（滑点保护）
    /// @param amountBMin 最少取回的 tokenB（滑点保护）
    /// @param to 代币接收地址
    /// @param deadline 截止时间
    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external ensure(deadline) returns (uint256 amountA, uint256 amountB) {
        address pair = factory.getPair(tokenA, tokenB);
        require(pair != address(0), "DefiRouter: PAIR_NOT_FOUND");

        // 先转 LP Token 到交易对
        _safeTransferFrom(pair, msg.sender, pair, liquidity);

        (amountA, amountB) = DefiPair(pair).burn(to);

        require(amountA >= amountAMin, "DefiRouter: INSUFFICIENT_A_AMOUNT");
        require(amountB >= amountBMin, "DefiRouter: INSUFFICIENT_B_AMOUNT");
    }

    // ── 查询函数 ──

    /// @notice 计算给定输入的预期输出
    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external view returns (uint256[] memory amounts)
    {
        return _getAmountsOut(amountIn, path);
    }

    /// @notice 计算给定输出的所需输入
    function getAmountsIn(uint256 amountOut, address[] calldata path)
        external view returns (uint256[] memory amounts)
    {
        require(path.length >= 2, "DefiRouter: INVALID_PATH");
        amounts = new uint256[](path.length);
        amounts[amounts.length - 1] = amountOut;

        for (uint256 i = path.length - 1; i > 0; i--) {
            (uint256 reserveIn, uint256 reserveOut) = _getReserves(path[i - 1], path[i]);
            amounts[i - 1] = _getAmountIn(amounts[i], reserveIn, reserveOut);
        }
    }

    /// @notice 按比例计算等价数量：amountB = amountA * reserveB / reserveA
    function _quote(uint256 amountA, uint256 reserveA, uint256 reserveB)
        internal pure returns (uint256 amountB)
    {
        require(amountA > 0, "DefiRouter: INSUFFICIENT_AMOUNT");
        require(reserveA > 0 && reserveB > 0, "DefiRouter: INSUFFICIENT_LIQUIDITY");
        amountB = amountA * reserveB / reserveA;
    }

    // ── 辅助函数 ──

    function _safeTransferFrom(address token, address from, address to, uint256 value) private {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20(token).transferFrom.selector, from, to, value)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "DefiRouter: TRANSFER_FROM_FAILED");
    }
}