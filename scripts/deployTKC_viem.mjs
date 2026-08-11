// 直接使用 viem 部署 TKC + 创建 TKB/TKC 池（绕过 hardhat 编译）
import { createPublicClient, createWalletClient, http, parseEther, maxUint256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { readFileSync } from "fs";

const DEPLOYER_PK = "93a5574eaabfd841db1b8a47f48b1a1986c53533ab099326beff8cc37888b08e";
const RPC = "https://sepolia.infura.io/v3/ef514354a2054393a72efb04202c6430";
const TKB = "0xbc4f9cc9e50347a0ac8b147db7c3c8886670b8c4";
const FACTORY = "0x0e43e1e2752ef5993642d2095f807953654285fc";
const ROUTER = "0x2e70c64055a3cd8bea2d899aa1fd72ddf838e440";

const account = privateKeyToAccount(`0x${DEPLOYER_PK}`);
const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC) });
const walletClient = createWalletClient({ chain: sepolia, transport: http(RPC), account });

const TestTokenArtifact = JSON.parse(readFileSync("./artifacts/contracts/TestToken.sol/TestToken.json", "utf-8"));
const DefiFactoryAbi = JSON.parse(readFileSync("./artifacts/contracts/DefiFactory.sol/DefiFactory.json", "utf-8")).abi;
const DefiRouterAbi = JSON.parse(readFileSync("./artifacts/contracts/DefiRouter.sol/DefiRouter.json", "utf-8")).abi;

const { abi: tokenAbi, bytecode: tokenBytecode } = TestTokenArtifact;

async function main() {
  console.log("Deploying with:", account.address);
  
  // 1. 部署 TKC
  console.log("\nDeploying TKC...");
  const deployHash = await walletClient.deployContract({
    abi: tokenAbi,
    bytecode: tokenBytecode,
    args: ["Token C", "TKC"],
  });
  console.log("Deploy tx:", deployHash);
  
  const deployReceipt = await publicClient.waitForTransactionReceipt({ hash: deployHash });
  const TKC = deployReceipt.contractAddress;
  console.log("TKC deployed to:", TKC);

  // 2. 创建 TKB/TKC pair
  console.log("\nCreating TKB/TKC pair...");
  const { request: createReq } = await publicClient.simulateContract({
    address: FACTORY,
    abi: DefiFactoryAbi,
    functionName: "createPair",
    args: [TKB, TKC],
    account: account.address,
  });
  const createHash = await walletClient.writeContract(createReq);
  const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createHash });
  console.log("Pair created, block:", createReceipt.blockNumber);
  
  const pairAddress = await publicClient.readContract({
    address: FACTORY,
    abi: DefiFactoryAbi,
    functionName: "getPair",
    args: [TKB, TKC],
  });
  console.log("TKB/TKC Pair:", pairAddress);

  // 3. Mint TKC to deployer
  console.log("\nMinting TKC...");
  const { request: mintReq } = await publicClient.simulateContract({
    address: TKC,
    abi: tokenAbi,
    functionName: "mint",
    args: [account.address, parseEther("1000000")],
    account: account.address,
  });
  const mintHash = await walletClient.writeContract(mintReq);
  await publicClient.waitForTransactionReceipt({ hash: mintHash });
  console.log("Minted 1,000,000 TKC");

  // 4. Approve TKB and TKC for Router
  console.log("\nApproving TKB...");
  const { request: approveTkbReq } = await publicClient.simulateContract({
    address: TKB,
    abi: tokenAbi,
    functionName: "approve",
    args: [ROUTER, maxUint256],
    account: account.address,
  });
  const approveTkbHash = await walletClient.writeContract(approveTkbReq);
  await publicClient.waitForTransactionReceipt({ hash: approveTkbHash });
  console.log("TKB approved");

  console.log("Approving TKC...");
  const { request: approveTkcReq } = await publicClient.simulateContract({
    address: TKC,
    abi: tokenAbi,
    functionName: "approve",
    args: [ROUTER, maxUint256],
    account: account.address,
  });
  const approveTkcHash = await walletClient.writeContract(approveTkcReq);
  await publicClient.waitForTransactionReceipt({ hash: approveTkcHash });
  console.log("TKC approved");

  // 5. Add liquidity (5000 TKB + 5000 TKC)
  console.log("\nAdding liquidity to TKB/TKC pool...");
  const { request: addLiqReq } = await publicClient.simulateContract({
    address: ROUTER,
    abi: DefiRouterAbi,
    functionName: "addLiquidity",
    args: [
      TKB, TKC,
      parseEther("5000"),
      parseEther("5000"),
      0n, 0n,
      account.address,
      BigInt(Math.floor(Date.now() / 1000) + 600),
    ],
    account: account.address,
  });
  const addLiqHash = await walletClient.writeContract(addLiqReq);
  await publicClient.waitForTransactionReceipt({ hash: addLiqHash });
  console.log("Liquidity added!");

  // 6. Summary
  console.log("\n===== 部署总结 =====");
  console.log("TKC:", TKC);
  console.log("TKB/TKC Pair:", pairAddress);
}

main().catch(console.error);
