// 部署脚本：部署两个测试代币 → Factory → Router → 创建初始交易对
import hre from "hardhat";

async function main() {
  const connection = await hre.network.connect();
  const [deployer] = await connection.viem.getWalletClients();
  console.log("Deploying with account:", deployer.account.address);

  // 1. 部署测试代币
  const TestToken = await connection.viem.deployContract("TestToken", ["Token A", "TKA"]);
  console.log("Token A deployed to:", TestToken.address);

  const TestTokenB = await connection.viem.deployContract("TestToken", ["Token B", "TKB"]);
  console.log("Token B deployed to:", TestTokenB.address);

  // 2. 部署工厂
  const Factory = await connection.viem.deployContract("DefiFactory");
  console.log("Factory deployed to:", Factory.address);

  // 3. 部署路由
  const Router = await connection.viem.deployContract("DefiRouter", [Factory.address]);
  console.log("Router deployed to:", Router.address);

  // 4. 创建初始交易对（TKA/TKB）
  console.log("\nCreating pair...");
  const createTx = await Factory.write.createPair([TestToken.address, TestTokenB.address]);
  console.log("Pair creation tx:", createTx);

  // 等待交易确认
  const publicClient = await connection.viem.getPublicClient();
  const receipt = await publicClient.waitForTransactionReceipt({ hash: createTx });
  console.log("Pair creation confirmed in block:", receipt.blockNumber);

  // 获取交易对地址
  const pairAddress = await Factory.read.getPair([TestToken.address, TestTokenB.address]);
  console.log("Pair address:", pairAddress);

  if (pairAddress === "0x0000000000000000000000000000000000000000") {
    // getPair 可能返回了旧值，重试
    console.log("Retrying getPair...");
    const retry = await Factory.read.getPair([TestToken.address, TestTokenB.address]);
    console.log("Pair address (retry):", retry);
  }

  // 5. 输出部署地址
  console.log("\n===== 部署总结 =====");
  console.log("Token A:", TestToken.address);
  console.log("Token B:", TestTokenB.address);
  console.log("Factory:", Factory.address);
  console.log("Router:", Router.address);
  console.log("Pair:", pairAddress);

  console.log("\n.env 配置：");
  console.log(`NEXT_PUBLIC_TOKEN_A=${TestToken.address}`);
  console.log(`NEXT_PUBLIC_TOKEN_B=${TestTokenB.address}`);
  console.log(`NEXT_PUBLIC_FACTORY_ADDRESS=${Factory.address}`);
  console.log(`NEXT_PUBLIC_ROUTER_ADDRESS=${Router.address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});