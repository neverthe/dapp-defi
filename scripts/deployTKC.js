// 部署 TKC 代币并创建 TKB/TKC 交易对（用于多池路由 A→B→C）
import hre from "hardhat";
import { parseEther } from "viem";

async function main() {
  const connection = await hre.network.connect();
  const [deployer] = await connection.viem.getWalletClients();
  console.log("Deploying with account:", deployer.account.address);

  // 已有合约地址
  const TKB = "0xbc4f9cc9e50347a0ac8b147db7c3c8886670b8c4";
  const FACTORY = "0x0e43e1e2752ef5993642d2095f807953654285fc";
  const ROUTER = "0x2e70c64055a3cd8bea2d899aa1fd72ddf838e440";

  // 1. 部署 TKC
  const TestToken = await connection.viem.deployContract("TestToken", ["Token C", "TKC"]);
  console.log("Token C (TKC) deployed to:", TestToken.address);

  // 2. 创建 TKB/TKC 交易对
  console.log("\nCreating TKB/TKC pair...");
  const factoryContract = await connection.viem.getContractAt("DefiFactory", FACTORY);
  const createTx = await factoryContract.write.createPair([TKB, TestToken.address]);
  console.log("Create pair tx:", createTx);

  const publicClient = await connection.viem.getPublicClient();
  const receipt = await publicClient.waitForTransactionReceipt({ hash: createTx });
  console.log("Pair creation confirmed in block:", receipt.blockNumber);

  const pairAddress = await factoryContract.read.getPair([TKB, TestToken.address]);
  console.log("TKB/TKC Pair address:", pairAddress);

  // 3. 铸造 TKC 给部署者
  console.log("\nMinting TKC to deployer...");
  const tkcContract = await connection.viem.getContractAt("TestToken", TestToken.address);
  const mintTx = await tkcContract.write.mint([deployer.account.address, parseEther("1000000")]);
  await publicClient.waitForTransactionReceipt({ hash: mintTx });
  console.log("Minted 1,000,000 TKC");

  // 4. 授权 Router 操作 TKB 和 TKC
  console.log("\nApproving Router for TKB and TKC...");
  const tkbContract = await connection.viem.getContractAt("TestToken", TKB);
  const approveTkb = await tkbContract.write.approve([ROUTER, parseEther("1000000000000")]);
  await publicClient.waitForTransactionReceipt({ hash: approveTkb });
  console.log("TKB approved");

  const approveTkc = await tkcContract.write.approve([ROUTER, parseEther("1000000000000")]);
  await publicClient.waitForTransactionReceipt({ hash: approveTkc });
  console.log("TKC approved");

  // 5. 添加初始流动性到 TKB/TKC 池（5000 TKB + 5000 TKC）
  console.log("\nAdding initial liquidity to TKB/TKC pool...");
  const routerContract = await connection.viem.getContractAt("DefiRouter", ROUTER);
  const addTx = await routerContract.write.addLiquidity([
    TKB,
    TestToken.address,
    parseEther("5000"),
    parseEther("5000"),
    0n,
    0n,
    deployer.account.address,
    BigInt(Math.floor(Date.now() / 1000) + 600),
  ]);
  await publicClient.waitForTransactionReceipt({ hash: addTx });
  console.log("Liquidity added to TKB/TKC pool!");

  // 6. 输出部署总结
  console.log("\n===== 部署总结 =====");
  console.log("TKC:", TestToken.address);
  console.log("TKB/TKC Pair:", pairAddress);
  console.log("\n.env 新增:");
  console.log(`NEXT_PUBLIC_TOKEN_C=${TestToken.address}`);
  console.log(`NEXT_PUBLIC_PAIR_B_C=${pairAddress}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
