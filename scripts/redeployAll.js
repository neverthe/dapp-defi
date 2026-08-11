// 重新部署 Factory + Router + 创建 Pair（修复 OZ 5.x _mint 兼容性）
import hre from "hardhat";

const TOKEN_A = "0x63e5203ea49fda92a163dc0df3b18d706b4d4c33";
const TOKEN_B = "0xbc4f9cc9e50347a0ac8b147db7c3c8886670b8c4";

async function main() {
  const connection = await hre.network.connect();
  const [deployer] = await connection.viem.getWalletClients();
  const publicClient = await connection.viem.getPublicClient();

  console.log("Deployer:", deployer.account.address);

  // 1. 部署新 Factory
  console.log("\n1. 部署 Factory...");
  const factory = await connection.viem.deployContract("DefiFactory", []);
  console.log("   Factory:", factory.address);

  // 2. 部署新 Router
  console.log("\n2. 部署 Router...");
  const router = await connection.viem.deployContract("DefiRouter", [factory.address]);
  console.log("   Router:", router.address);

  // 3. 创建 Pair
  console.log("\n3. 创建 Pair...");
  const createTx = await factory.write.createPair([TOKEN_A, TOKEN_B]);
  await publicClient.waitForTransactionReceipt({ hash: createTx });
  const pairAddr = await factory.read.getPair([TOKEN_A, TOKEN_B]);
  console.log("   Pair:", pairAddr);

  // 4. 验证 Pair
  const pair = await connection.viem.getContractAt("DefiPair", pairAddr);
  const token0 = await pair.read.token0();
  const token1 = await pair.read.token1();
  console.log("   token0:", token0);
  console.log("   token1:", token1);

  // 5. 测试 addLiquidity
  console.log("\n4. 授权 + 测试 addLiquidity...");
  const tokenA = await connection.viem.getContractAt("TestToken", TOKEN_A);
  const tokenB = await connection.viem.getContractAt("TestToken", TOKEN_B);

  const approveA = await tokenA.write.approve([router.address, 2n ** 256n - 1n]);
  await publicClient.waitForTransactionReceipt({ hash: approveA });
  const approveB = await tokenB.write.approve([router.address, 2n ** 256n - 1n]);
  await publicClient.waitForTransactionReceipt({ hash: approveB });
  console.log("   授权完成 ✓");

  const amountA = 1000000000000000000n; // 1 TKA
  const amountB = 1000000000000000000n; // 1 TKB
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);

  try {
    const tx = await router.write.addLiquidity([
      TOKEN_A, TOKEN_B, amountA, amountB, 0n, 0n, deployer.account.address, deadline
    ]);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
    console.log("   addLiquidity:", receipt.status === "success" ? "✅ 成功!" : "❌ 失败");
  } catch (err) {
    console.log("   ❌ 失败:", err.message?.substring(0, 200));
  }

  console.log("\n===== 请更新 .env =====");
  console.log(`NEXT_PUBLIC_FACTORY_ADDRESS=${factory.address}`);
  console.log(`NEXT_PUBLIC_ROUTER_ADDRESS=${router.address}`);
  console.log(`NEXT_PUBLIC_PAIR_ADDRESS=${pairAddr}`);
  console.log("\n旧地址（废弃）:");
  console.log("  Old Factory: 0xadf01b65647cfb61c416ce6e23c1f61375fa2f9a");
  console.log("  Old Router:  0x17c5e741eb28cc1be3e6b47af541adc92f7b063b");
  console.log("  Old Pair:    0x707E01263b009167affD2EC3dC478482cdf4E169");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});