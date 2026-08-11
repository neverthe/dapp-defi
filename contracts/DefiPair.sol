// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title DefiPair
 * @notice AMM 交易对合约，实现恒定乘积公式 x × y = k
 * 
 * 核心机制：
 * - 恒定乘积：reserve0 × reserve1 = k（swap 后 k 不变或增大）
 * - 手续费 0.3%：每次 swap 收取 0.3% 归 LP 持有者
 * - LP Token：代表流动性份额，增发/销毁与流动性比例挂钩
 * - 滑点保护：minAmountOut 参数防止 MEV 三明治攻击
 * - TWAP 预言机：记录时间加权均价，防止闪电贷价格操纵
 */
//  让 DefiPair 本身就是一个 LP Token（流动性提供者收到的是这个合约的 ERC20 代币）
// ReentrancyGuard：防止重入攻击（nonReentrant 修饰符会锁住函数，防止递归调用）。
contract DefiPair is ERC20, ReentrancyGuard {
    // ── 状态变量 ──
    address public factory;          // 工厂合约地址
    address public token0;           // 代币0（地址较小的）
    address public token1;           // 代币1（地址较大的）token0 < token1 ：地址排序，保证唯一性

// AMM 公式 x×y=k 中，储备量用 112 位足够表示绝大多数代币数量，同时相乘不会溢出，还能节省 gas。
// 用 uint112 而不是 uint256 ，主要是为了 存储优化 和 防溢出 。
    uint112 private reserve0;        // 代币0 储备量
    uint112 private reserve1;        // 代币1 储备量
    uint32  private blockTimestampLast; // 上次更新时间

// TWAP 数据：时间加权均价，防止闪电贷价格操纵
    uint256 public price0CumulativeLast; // 代币0 累计价格（用于 TWAP）
    uint256 public price1CumulativeLast; // 代币1 累计价格（用于 TWAP）

    uint256 public constant MINIMUM_LIQUIDITY = 10 ** 3; // 最小流动性（防粉尘攻击）
    uint256 public constant FEE_DENOMINATOR = 1000;       // 手续费分母
    uint256 public constant FEE_NUMERATOR = 3;            // 手续费分子 = 0.3%

    // ── 事件 ──
    // Mint添加流动性事件    Burn ：移除流动性事件  Swap ：代币兑换事件  Sync ：储备量同步事件
    event Mint(address indexed sender, uint256 amount0, uint256 amount1);
    event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to);
    event Swap(
        address indexed sender,
        uint256 amount0In,
        uint256 amount1In,
        uint256 amount0Out,
        uint256 amount1Out,
        address indexed to
    );
    event Sync(uint112 reserve0, uint112 reserve1);
    // 调用 ERC20 构造函数，设置 LP Token 名称和符号，设置 factory 为创建者地址
    constructor() ERC20("DeFi LP Token", "DLP") {
        factory = msg.sender;
    }

    /// @notice 初始化交易对，仅在工厂创建时调用一次
    function initialize(address _token0, address _token1) external {
        require(msg.sender == factory, "DefiPair: FORBIDDEN");
        // 确保 token0 < token1（地址排序，保证唯一性）
        (token0, token1) = _token0 < _token1 ? (_token0, _token1) : (_token1, _token0);
    }

    // ── 内部函数 ──

    /// @notice 获取当前储备量
    function getReserves() public view returns (uint112 _reserve0, uint112 _reserve1, uint32 _blockTimestampLast) {
        _reserve0 = reserve0;
        _reserve1 = reserve1;
        _blockTimestampLast = blockTimestampLast;
    }

    /// @notice 同步储备量并更新 TWAP 累计价格
    function _update(uint256 balance0, uint256 balance1, uint112 _reserve0, uint112 _reserve1) private {
    //    确保了 reserve0 和 reserve1 在赋值时不会溢出 112 位的容器，从而保护了存储打包设计的完整性。
        require(balance0 <= type(uint112).max && balance1 <= type(uint112).max, "DefiPair: OVERFLOW");

        uint32 blockTimestamp = uint32(block.timestamp % 2 ** 32);
        // 两个区块之间的时间差。
        uint32 timeElapsed = blockTimestamp - blockTimestampLast;

        // 更新 TWAP 累计价格（时间加权）
        // 闪电贷的攻击路径：黑客在同一笔交易里借出巨款 → 瞬间砸盘拉低价格 → 利用低价清算别人 → 最后还款。整个过程耗时 3 秒（一个区块）
        // price0CumulativeLast 累加了过去所有时间的价格。黑客那 3 秒的极端价格，扔进可能几小时甚至几天的累加器里，几乎不影响最终平均值。
        // 如果黑客想操纵 TWAP，他需要连续半个小时维持虚假价格，但维持这么久需要的资金成本（滑点、手续费）远超攻击利润，经济上不可行。
        if (timeElapsed > 0 && _reserve0 != 0 && _reserve1 != 0) {
            //  “时间加权” 的含义——价格维持越久，权重越大
            price0CumulativeLast += uint256(UQ112x112.uqdiv(UQ112x112.encode(_reserve1), _reserve0)) * timeElapsed;
            price1CumulativeLast += uint256(UQ112x112.uqdiv(UQ112x112.encode(_reserve0), _reserve1)) * timeElapsed;
        }
// 更新为当前合约的实际余额，当前区块时间戳
        reserve0 = uint112(balance0);
        reserve1 = uint112(balance1);
        blockTimestampLast = blockTimestamp;
//实时更新 UI 显示的池子储备量。
        emit Sync(reserve0, reserve1);
    }

    /// @notice 铸造费用（平台费，此处简化为0，全部归 LP）
    //  Pair 合约目前关闭了平台费，所有 0.3% 手续费 100% 分配给 LP 持有者。
    // Uniswap V2 中平台费是协议级开关，由 Factory 的 feeTo 地址控制，开启后会从累计的手续费中抽取 1/6 铸造给协议金库。
    // 我在初版中暂时留空，便于聚焦核心功能测试，后续可通过升级合约或治理模块再开启。"
    function _mintFee(uint112 _reserve0, uint112 _reserve1) private pure returns (bool) {
        // 简化版：硬编码 false 不收取平台费，所有手续费归 LP 
        _reserve0; _reserve1;// 这两行只为了消除编译警告（未使用参数）
        return false;
    }

    // ── 流动性操作 ──

    /// @notice 添加流动性，铸造 LP Token
    /// @param to LP Token 接收地址
    /// @return liquidity 铸造的 LP Token 数量
    function mint(address to) external nonReentrant returns (uint256 liquidity) {
        // getReserves()：读取上一次记录在合约里的储备量（_reserve0/_reserve1）
        (uint112 _reserve0, uint112 _reserve1,) = getReserves();
        // 读取合约当前实际持有的两种代币余额。
        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));
        // 计算新增代币数量
        uint256 amount0 = balance0 - _reserve0;
        uint256 amount1 = balance1 - _reserve1;

        bool feeOn = _mintFee(_reserve0, _reserve1);
        uint256 _totalSupply = totalSupply();

        if (_totalSupply == 0) {
            // 首次添加流动性：sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY
            liquidity = _sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY;
            // 永久锁定最小流动性，防止粉尘攻击
            // OZ 5.x 不允许 _mint 到 address(0)，改用死地址锁定
            _mint(address(0xdead), MINIMUM_LIQUIDITY);
        } else {
            // 按比例铸造：min(amount0 * totalSupply / reserve0, amount1 * totalSupply / reserve1)
            liquidity = _min(
                amount0 * _totalSupply / _reserve0,
                amount1 * _totalSupply / _reserve1
            );
        }

        require(liquidity > 0, "DefiPair: INSUFFICIENT_LIQUIDITY_MINTED");
        _mint(to, liquidity);

        _update(balance0, balance1, _reserve0, _reserve1);

        if (feeOn) {
            // 平台费逻辑（预留）
        }

        emit Mint(msg.sender, amount0, amount1);
    }

    /// @notice 移除流动性，销毁 LP Token，按比例取回两个代币
    /// @param to 代币接收地址
    /// @return amount0 取回的代币0数量
    /// @return amount1 取回的代币1数量
    function burn(address to) external nonReentrant returns (uint256 amount0, uint256 amount1) {
        (uint112 _reserve0, uint112 _reserve1,) = getReserves();
       
        address _token0 = token0;
        address _token1 = token1;
        uint256 balance0 = IERC20(_token0).balanceOf(address(this));
        uint256 balance1 = IERC20(_token1).balanceOf(address(this));
        uint256 liquidity = balanceOf(address(this));

        bool feeOn = _mintFee(_reserve0, _reserve1);
        uint256 _totalSupply = totalSupply();

        // 按 LP Token 占比计算应取回的代币数量
        amount0 = liquidity * balance0 / _totalSupply;
        amount1 = liquidity * balance1 / _totalSupply;

        require(amount0 > 0 && amount1 > 0, "DefiPair: INSUFFICIENT_LIQUIDITY_BURNED");

        _burn(address(this), liquidity);
        _safeTransfer(_token0, to, amount0);
        _safeTransfer(_token1, to, amount1);

        balance0 = IERC20(_token0).balanceOf(address(this));
        balance1 = IERC20(_token1).balanceOf(address(this));

        _update(balance0, balance1, _reserve0, _reserve1);

        if (feeOn) {
            // 平台费逻辑（预留）
        }

        emit Burn(msg.sender, amount0, amount1, to);
    }

    // ── Swap 兑换 ──

    /// @notice 执行代币兑换（x × y = k）
    /// @param amount0Out 想要输出的 token0 数量
    /// @param amount1Out 想要输出的 token1 数量
    /// @param to 输出代币的接收地址
    /// @param data 回调数据（支持 flash swap）
    function swap(
        uint256 amount0Out,
        uint256 amount1Out,
        address to,
        bytes calldata data
    ) external nonReentrant {
        require(amount0Out > 0 || amount1Out > 0, "DefiPair: INSUFFICIENT_OUTPUT_AMOUNT");
        (uint112 _reserve0, uint112 _reserve1,) = getReserves();
        require(amount0Out < _reserve0 && amount1Out < _reserve1, "DefiPair: INSUFFICIENT_LIQUIDITY");

        uint256 balance0;
        uint256 balance1;

        {
            address _token0 = token0;
            address _token1 = token1;
            require(to != _token0 && to != _token1, "DefiPair: INVALID_TO");

            // 先转出代币（乐观转账）
            if (amount0Out > 0) _safeTransfer(_token0, to, amount0Out);
            if (amount1Out > 0) _safeTransfer(_token1, to, amount1Out);

            // 回调（支持 flash swap）
            if (data.length > 0) {
                IDefiCallee(to).defiCall(msg.sender, amount0Out, amount1Out, data);
            }

            balance0 = IERC20(_token0).balanceOf(address(this));
            balance1 = IERC20(_token1).balanceOf(address(this));
        }

        uint256 amount0In = balance0 > _reserve0 - amount0Out
            ? balance0 - (_reserve0 - amount0Out)
            : 0;
        uint256 amount1In = balance1 > _reserve1 - amount1Out
            ? balance1 - (_reserve1 - amount1Out)
            : 0;

        require(amount0In > 0 || amount1In > 0, "DefiPair: INSUFFICIENT_INPUT_AMOUNT");

        {
            // 验证 k 值：扣除 0.3% 手续费后的新 k 必须 >= 旧 k
            // 手续费留在池中，所以新 k 总是 >= 旧 k
            uint256 balance0Adjusted = balance0 * 1000 - amount0In * 3;
            uint256 balance1Adjusted = balance1 * 1000 - amount1In * 3;

            require(
                balance0Adjusted * balance1Adjusted >= uint256(_reserve0) * uint256(_reserve1) * (1000 ** 2),
                "DefiPair: K"
            );
        }

        _update(balance0, balance1, _reserve0, _reserve1);

        emit Swap(msg.sender, amount0In, amount1In, amount0Out, amount1Out, to);
    }

    // ── 辅助函数 ──

    /// @notice 安全转账（兼容不返回 bool 的 ERC20）
    function _safeTransfer(address token, address to, uint256 value) private {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20.transfer.selector, to, value)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "DefiPair: TRANSFER_FAILED");
    }

    function _min(uint256 x, uint256 y) private pure returns (uint256) {
        return x < y ? x : y;
    }

    function _sqrt(uint256 y) private pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }

    /// @notice 强制同步储备量（用于处理非标准转账的代币）
    function sync() external nonReentrant {
        _update(
            IERC20(token0).balanceOf(address(this)),
            IERC20(token1).balanceOf(address(this)),
            reserve0,
            reserve1
        );
    }

    /// @notice 跳过更新，直接设储备量（内部使用）
    function skim(address to) external nonReentrant {
        address _token0 = token0;
        address _token1 = token1;
        _safeTransfer(_token0, to, IERC20(_token0).balanceOf(address(this)) - reserve0);
        _safeTransfer(_token1, to, IERC20(_token1).balanceOf(address(this)) - reserve1);
    }
}

// ── 接口 ──

/// @notice Flash swap 回调接口
interface IDefiCallee {
    function defiCall(address sender, uint256 amount0, uint256 amount1, bytes calldata data) external;
}

/// @notice UQ112.112 定点数库（用于 TWAP 价格存储）
library UQ112x112 {
    uint224 constant Q112 = 2 ** 112;

    function encode(uint112 y) internal pure returns (uint224 z) {
        z = uint224(y) * Q112;
    }

    function uqdiv(uint224 x, uint112 y) internal pure returns (uint224 z) {
        z = x / uint224(y);
    }
}