// 直接使用 viem 部署 TKC 后续步骤（TKC 已部署: 0xa0a961748ac59a3fdda6899a05c6164d36f72c24）
import { createPublicClient, http, parseEther, maxUint256, encodeFunctionData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { readFileSync } from "fs";

const DEPLOYER_PK = "0x93a5574eaabfd841db1b8a47f48b1a1986c53533ab099326beff8cc37888b08e";
const RPC = "https://sepolia.infura.io/v3/ef514354a2054393a72efb04202c6430";
const TKB = "0xbc4f9cc9e50347a0ac8b147db7c3c8886670b8c4";
const TKC = "0xa0a961748ac59a3fdda6899a05c6164d36f72c24";
const FACTORY = "0x0e43e1e2752ef5993642d2095f807953654285fc";
const ROUTER = "0x2e70c64055a3cd8bea2d899aa1fd72ddf838e440";

const account = privateKeyToAccount(DEPLOYER_PK);
const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC) });

const TestTokenArtifact = JSON.parse(readFileSync("./artifacts/contracts/TestToken.sol/TestToken.json", "utf-8"));
const DefiFactoryAbi = JSON.parse(readFileSync("./artifacts/contracts/DefiFactory.sol/DefiFactory.json", "utf-8")).abi;
const DefiRouterAbi = JSON.parse(readFileSync("./artifacts/contracts/DefiRouter.sol/DefiRouter.json", "utf-8")).abi;

const { abi: tokenAbi } = TestTokenArtifact;

async function sendTx(to, data, value = 0n) {
  const nonce = await publicClient.getTransactionCount({ address: account.address });
  const gasPrice = await publicClient.getGasPrice();
  const gas = await publicClient.estimateGas({
    account: account.address,
    to,
    data,
    value,
  });
  
  const signed = await account.signTransaction({
    to, data, value, nonce, gasPrice, gas,
    chainId: 11155111,
  });
  
  const hash = await publicClient.sendRawTransaction({ serializedTransaction: signed });
  console.log("  Tx:", hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("  Confirmed, block:", receipt.blockNumber);
  return receipt;
}

async function main() {
  console.log("Account:", account.address);
  console.log("TKC:", TKC);

  // 1. Create TKB/TKC pair
  console.log("\n1. Creating TKB/TKC pair...");
  await sendTx(FACTORY, encodeFunctionData({
    abi: DefiFactoryAbi,
    functionName: "createPair",
    args: [TKB, TKC],
  }));

  const pairAddress = await publicClient.readContract({
    address: FACTORY,
    abi: DefiFactoryAbi,
    functionName: "getPair",
    args: [TKB, TKC],
  });
  console.log("   TKB/TKC Pair:", pairAddress);

  // 2. Mint TKC
  console.log("\n2. Minting TKC...");
  await sendTx(TKC, encodeFunctionData({
    abi: tokenAbi,
    functionName: "mint",
    args: [account.address, parseEther("1000000")],
  }));
  console.log("   Minted 1,000,000 TKC");

  // 3. Approve TKB
  console.log("\n3. Approving TKB...");
  await sendTx(TKB, encodeFunctionData({
    abi: tokenAbi,
    functionName: "approve",
    args: [ROUTER, maxUint256],
  }));
  console.log("   TKB approved");

  // 4. Approve TKC
  console.log("\n4. Approving TKC...");
  await sendTx(TKC, encodeFunctionData({
    abi: tokenAbi,
    functionName: "approve",
    args: [ROUTER, maxUint256],
  }));
  console.log("   TKC approved");

  // 5. Add liquidity
  console.log("\n5. Adding liquidity (5000 TKB + 5000 TKC)...");
  await sendTx(ROUTER, encodeFunctionData({
    abi: DefiRouterAbi,
    functionName: "addLiquidity",
    args: [
      TKB, TKC,
      parseEther("5000"), parseEther("5000"),
      0n, 0n,
      account.address,
      BigInt(Math.floor(Date.now() / 1000) + 600),
    ],
  }));
  console.log("   Liquidity added!");

  // Summary
  console.log("\n===== 部署总结 =====");
  console.log("TKC:", TKC);
  console.log("TKB/TKC Pair:", pairAddress);
}

main().catch(console.error);
