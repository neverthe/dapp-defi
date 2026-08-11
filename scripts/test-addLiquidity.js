// 深度诊断：检查 Router 内部状态
import hre from "hardhat";

const TOKEN_A = "0x63e5203ea49fda92a163dc0df3b18d706b4d4c33";
const TOKEN_B = "0xbc4f9cc9e50347a0ac8b147db7c3c8886670b8c4";
const FACTORY = "0xadf01b65647cfb61c416ce6e23c1f61375fa2f9a";
const ROUTER = "0x17c5e741eb28cc1be3e6b47af541adc92f7b063b";

async function main() {
  const connection = await hre.network.connect();
  const [deployer] = await connection.viem.getWalletClients();
  const publicClient = await connection.viem.getPublicClient();

  console.log("=== 深度诊断 ===\n");

  const router = await connection.viem.getContractAt("DefiRouter", ROUTER);
  const factory = await connection.viem.getContractAt("DefiFactory", FACTORY);

  // 1. 检查 Router 的 factory 变量
  const routerFactory = await router.read.factory();
  console.log("1. Router.factory():", routerFactory);
  console.log("   预期 Factory:", FACTORY);
  console.log("   匹配:", routerFactory.toLowerCase() === FACTORY.toLowerCase() ? "YES" : "NO !!!");

  // 2. 通过 Factory 查 Pair（两个方向）
  const pairAB = await factory.read.getPair([TOKEN_A, TOKEN_B]);
  const pairBA = await factory.read.getPair([TOKEN_B, TOKEN_A]);
  console.log("\n2. Factory.getPair(TKA, TKB):", pairAB);
  console.log("   Factory.getPair(TKB, TKA):", pairBA);

  // 3. 检查 Pair 是否是合约
  const pairCode = await publicClient.getCode({ address: pairAB });
  console.log("\n3. Pair 合约代码存在:", pairCode && pairCode !== "0x" ? "YES" : "NO - 不存在!!!");

  // 4. 如果 Pair 存在，检查 token0/token1
  if (pairCode && pairCode !== "0x") {
    const pair = await connection.viem.getContractAt("DefiPair", pairAB);
    const token0 = await pair.read.token0();
    const token1 = await pair.read.token1();
    console.log("\n4. Pair.token0:", token0);
    console.log("   Pair.token1:", token1);
  }

  // 5. 用 eth_call 模拟 addLiquidity
  const amountA = 1000000000000000000n;
  const amountB = 1000000000000000000n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);

  console.log("\n5. 模拟 addLiquidity...");
  try {
    await publicClient.simulateContract({
      address: ROUTER,
      abi: router.abi,
      functionName: 'addLiquidity',
      args: [TOKEN_A, TOKEN_B, amountA, amountB, 0n, 0n, deployer.account.address, deadline],
      account: deployer.account,
    });
    console.log("模拟成功");
  } catch (err) {
    console.log("模拟失败!");
    console.log("错误:", err.message ? err.message.substring(0, 300) : "unknown");

    if (err.data) {
      console.log("\nRaw revert data:", err.data);
      if (err.data.startsWith('0xec442f05')) {
        // ERC20InvalidReceiver(address) - 解码 receiver 地址
        const receiverAddr = '0x' + err.data.slice(34);
        console.log("=> ERC20InvalidReceiver, receiver =", receiverAddr);
      }
    }
  }

  console.log("\n=== 诊断结束 ===");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});