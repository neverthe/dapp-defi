// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./DefiPair.sol";

/**
 * @title DefiFactory
 * @notice 工厂合约，用于创建和追踪所有 AMM 交易对
 * 
 * 功能：
 * - 创建交易对：createPair(tokenA, tokenB)
 * - 查询交易对：getPair(tokenA, tokenB)
 * - 遍历所有交易对：allPairs[index]
 * - 生成 LP Token 名称和符号
 */
contract DefiFactory {
    // ── 事件 ──
    // ndexed 加在 token0 和 token1 上，方便前端（或 The Graph 子图）通过这两个代币地址快速过滤出相关池子。
  // address pair新创建的交易对合约地址   uint256交易对数量（第几个池子）
  //getPair[tokenA][tokenB] 和 getPair[tokenB][tokenA] 都有效，因为 createPair 里会 按地址排序 （小的放 token0
    event PairCreated(address indexed token0, address indexed token1, address pair, uint256);

    // ── 状态变量 ──getPair[tokenA][tokenB] → 返回这个交易对的合约地址。
    mapping(address => mapping(address => address)) public getPair; // tokenA => tokenB => pair
    address[] public allPairs;                                      // 所有交易对列表

    /// @notice 创建新的交易对
    /// @param tokenA 第一个代币地址
    /// @param tokenB 第二个代币地址
    /// @return pair 新创建的交易对地址
    function createPair(address tokenA, address tokenB) external returns (address pair) {
        require(tokenA != tokenB, "DefiFactory: IDENTICAL_ADDRESSES");
        // 确保 token0 < token1
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(token0 != address(0), "DefiFactory: ZERO_ADDRESS");
        require(getPair[token0][token1] == address(0), "DefiFactory: PAIR_EXISTS");

        // 使用 CREATE2 部署（确定性地址）
        bytes memory bytecode = type(DefiPair).creationCode;
        bytes32 salt = keccak256(abi.encodePacked(token0, token1));
        assembly {
            pair := create2(0, add(bytecode, 32), mload(bytecode), salt)
        }

        DefiPair(pair).initialize(token0, token1);

        getPair[token0][token1] = pair;
        getPair[token1][token0] = pair;
        allPairs.push(pair);

        emit PairCreated(token0, token1, pair, allPairs.length);
    }

    /// @notice 获取所有交易对数量
    function allPairsLength() external view returns (uint256) {
        return allPairs.length;
    }

    /// @notice 计算 CREATE2 地址（用于前端预计算）
    function pairFor(address tokenA, address tokenB) external view returns (address) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        bytes32 salt = keccak256(abi.encodePacked(token0, token1));
        return address(uint160(uint256(keccak256(abi.encodePacked(
            bytes1(0xff),
            address(this),
            salt,
            keccak256(type(DefiPair).creationCode)
        )))));
    }
}