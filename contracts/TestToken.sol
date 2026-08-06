// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title TestToken
 * @notice 简单的 ERC20 测试代币，用于在 AMM 中创建交易对
 * 部署时铸造 1,000,000 个代币给部署者，支持后续 mint
 */
contract TestToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, 1_000_000 * 10 ** decimals());
    }

    /// @notice 铸造新代币（仅用于测试）
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}