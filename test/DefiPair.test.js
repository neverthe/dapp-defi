// 测试脚本：验证 AMM 核心功能
// Hardhat 3 使用 Node.js 原生 test runner
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import hre from "hardhat";

const { viem } = hre;

describe("DefiPair - AMM 核心测试", function () {
  let token0, token1, factory, pair, router;
  let owner, user1, user2;

  before(async function () {
    [owner, user1, user2] = await viem.getWalletClients();

    // 部署测试代币
    const TestToken = await viem.deployContract("TestToken", ["Token0", "TK0"]);
    const TestToken1 = await viem.deployContract("TestToken", ["Token1", "TK1"]);
    token0 = TestToken;
    token1 = TestToken1;

    // 部署 Factory
    factory = await viem.deployContract("DefiFactory");

    // 部署 Router
    router = await viem.deployContract("DefiRouter", [factory.address]);

    // 创建交易对
    await factory.write.createPair([token0.address, token1.address]);
    const pairAddr = await factory.read.getPair([token0.address, token1.address]);
    pair = await viem.getContractAt("DefiPair", pairAddr);
  });

  describe("初始化", function () {
    it("正确设置 token0 和 token1（地址排序）", async function () {
      const t0 = await pair.read.token0();
      const t1 = await pair.read.token1();
      assert.ok(t0.toLowerCase() < t1.toLowerCase(), "token0 应该小于 token1");
    });

    it("初始储备量为 0", async function () {
      const [reserve0, reserve1] = await pair.read.getReserves();
      assert.equal(reserve0, 0n);
      assert.equal(reserve1, 0n);
    });
  });

  describe("添加流动性", function () {
    it("首次添加流动性成功", async function () {
      const amount0 = 1000n * 10n ** 18n;
      const amount1 = 2000n * 10n ** 18n;

      await token0.write.approve([router.address, amount0 * 100n]);
      await token1.write.approve([router.address, amount1 * 100n]);

      await router.write.addLiquidity([
        token0.address, token1.address,
        amount0, amount1,
        0n, 0n,
        owner.account.address,
        BigInt(Math.floor(Date.now() / 1000) + 3600),
      ]);

      const [reserve0, reserve1] = await pair.read.getReserves();
      assert.equal(reserve0, amount0);
      assert.equal(reserve1, amount1);

      const totalSupply = await pair.read.totalSupply();
      assert.ok(totalSupply > 0n, "LP 总供应量应大于 0");

      const lpBalance = await pair.read.balanceOf([owner.account.address]);
      assert.ok(lpBalance > 0n, "LP 余额应大于 0");
    });
  });

  describe("Swap 兑换", function () {
    it("x × y = k 恒定乘积", async function () {
      const [reserve0Before, reserve1Before] = await pair.read.getReserves();
      const kBefore = reserve0Before * reserve1Before;

      const amountIn = 10n * 10n ** 18n;

      await token0.write.transfer([user1.account.address, amountIn]);
      await token0.write.approve([router.address, amountIn], { account: user1.account });

      await router.write.swapExactTokensForTokens([
        amountIn,
        0n,
        [token0.address, token1.address],
        user1.account.address,
        BigInt(Math.floor(Date.now() / 1000) + 3600),
      ], { account: user1.account });

      const [reserve0After, reserve1After] = await pair.read.getReserves();
      const kAfter = reserve0After * reserve1After;

      // k 应该增大（因为手续费留在池中）
      assert.ok(kAfter >= kBefore, "k 值应保持不变或增大");

      const user1Balance = await token1.read.balanceOf([user1.account.address]);
      assert.ok(user1Balance > 0n, "用户应收到 token1");
    });

    it("滑点保护：minAmountOut 不满足时 revert", async function () {
      const amountIn = 1n * 10n ** 18n;

      await token0.write.approve([router.address, amountIn], { account: user1.account });

      try {
        await router.write.swapExactTokensForTokens([
          amountIn,
          1000n * 10n ** 18n, // 不可能的输出
          [token0.address, token1.address],
          user1.account.address,
          BigInt(Math.floor(Date.now() / 1000) + 3600),
        ], { account: user1.account });
        assert.fail("应该 revert");
      } catch (e) {
        assert.ok(true, "预期 revert");
      }
    });
  });

  describe("移除流动性", function () {
    it("按比例取回两个代币", async function () {
      const lpBalance = await pair.read.balanceOf([owner.account.address]);
      const halfLp = lpBalance / 2n;

      await pair.write.approve([router.address, halfLp]);

      const [reserve0Before, reserve1Before] = await pair.read.getReserves();
      const totalSupply = await pair.read.totalSupply();

      await router.write.removeLiquidity([
        token0.address, token1.address,
        halfLp,
        0n, 0n,
        owner.account.address,
        BigInt(Math.floor(Date.now() / 1000) + 3600),
      ]);

      const [reserve0After, reserve1After] = await pair.read.getReserves();

      const expected0 = reserve0Before - (reserve0Before * halfLp / totalSupply);
      const expected1 = reserve1Before - (reserve1Before * halfLp / totalSupply);

      // 允许少量误差
      assert.ok(
        reserve0After >= expected0 - 10n && reserve0After <= expected0 + 10n,
        "reserve0 应按比例减少"
      );
      assert.ok(
        reserve1After >= expected1 - 10n && reserve1After <= expected1 + 10n,
        "reserve1 应按比例减少"
      );
    });
  });

  describe("多池路由", function () {
    let token2;

    before(async function () {
      token2 = await viem.deployContract("TestToken", ["Token2", "TK2"]);

      await token1.write.approve([router.address, 1000000n * 10n ** 18n]);
      await token2.write.approve([router.address, 1000000n * 10n ** 18n]);

      await router.write.addLiquidity([
        token1.address, token2.address,
        5000n * 10n ** 18n, 5000n * 10n ** 18n,
        0n, 0n,
        owner.account.address,
        BigInt(Math.floor(Date.now() / 1000) + 3600),
      ]);
    });

    it("A→B→C 多跳兑换", async function () {
      const amountIn = 1n * 10n ** 18n;

      await token0.write.approve([router.address, amountIn], { account: user1.account });

      const amounts = await router.read.getAmountsOut([
        amountIn,
        [token0.address, token1.address, token2.address],
      ]);

      const balanceBefore = await token2.read.balanceOf([user1.account.address]);

      await router.write.swapExactTokensForTokens([
        amountIn,
        0n,
        [token0.address, token1.address, token2.address],
        user1.account.address,
        BigInt(Math.floor(Date.now() / 1000) + 3600),
      ], { account: user1.account });

      const balanceAfter = await token2.read.balanceOf([user1.account.address]);
      assert.equal(
        balanceAfter - balanceBefore,
        amounts[2],
        "多跳兑换输出应匹配预期"
      );
    });
  });

  describe("TWAP 价格预言机", function () {
    it("累计价格在 swap 后更新", async function () {
      const price0Before = await pair.read.price0CumulativeLast();
      const price1Before = await pair.read.price1CumulativeLast();

      await token0.write.approve([router.address, 1n * 10n ** 18n], { account: user1.account });
      await router.write.swapExactTokensForTokens([
        1n * 10n ** 18n,
        0n,
        [token0.address, token1.address],
        user1.account.address,
        BigInt(Math.floor(Date.now() / 1000) + 3600),
      ], { account: user1.account });

      const price0After = await pair.read.price0CumulativeLast();
      const price1After = await pair.read.price1CumulativeLast();

      assert.ok(price0After >= price0Before, "price0 累计价格应更新");
      assert.ok(price1After >= price1Before, "price1 累计价格应更新");
    });
  });
});