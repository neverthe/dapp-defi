// 铸币脚本：给指定用户铸造测试代币
import hre from "hardhat";

const TOKEN_A = "0x63e5203ea49fda92a163dc0df3b18d706b4d4c33";
const TOKEN_B = "0xbc4f9cc9e50347a0ac8b147db7c3c8886670b8c4";
const USER = "0x0bE3C39464b680B03CF20c7b17b171a45a2499e5";

// 铸币数量（每个 10000 个）
const MINT_AMOUNT = 10000n * 10n ** 18n;

async function main() {
  const connection = await hre.network.connect();
  const publicClient = await connection.viem.getPublicClient();
  console.log("目标用户:", USER);

  const tokenA = await connection.viem.getContractAt("TestToken", TOKEN_A);
  const tokenB = await connection.viem.getContractAt("TestToken", TOKEN_B);

  // 铸币并等待确认
  console.log("\n铸造 TKA...");
  const txA = await tokenA.write.mint([USER, MINT_AMOUNT]);
  await publicClient.waitForTransactionReceipt({ hash: txA });
  const balanceA = await tokenA.read.balanceOf([USER]);
  console.log("TKA 余额:", balanceA.toString());

  console.log("铸造 TKB...");
  const txB = await tokenB.write.mint([USER, MINT_AMOUNT]);
  await publicClient.waitForTransactionReceipt({ hash: txB });
  const balanceB = await tokenB.read.balanceOf([USER]);
  console.log("TKB 余额:", balanceB.toString());

  console.log("\n===== 完成 =====");
  console.log("请在 MetaMask 前端页面点击授权按钮，然后添加流动性");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});