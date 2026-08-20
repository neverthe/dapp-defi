// 创建交易对脚本（工厂已部署后单独运行）
import hre from "hardhat";

const FACTORY = "0xadf01b65647cfb61c416ce6e23c1f61375fa2f9a";
const TOKEN_A = "0x63e5203ea49fda92a163dc0df3b18d706b4d4c33";
const TOKEN_B = "0xbc4f9cc9e50347a0ac8b147db7c3c8886670b8c4";

async function main() {
  const connection = await hre.network.connect();
  const factory = await connection.viem.getContractAt("DefiFactory", FACTORY);

  // 检查是否已存在
  const existing = await factory.read.getPair([TOKEN_A, TOKEN_B]);
  console.log("Existing pair:", existing);
  if (existing !== "0x0000000000000000000000000000000000000000") {
    console.log("Pair already exists!");
    return;
  }

  console.log("Creating pair...");
  const tx = await factory.write.createPair([TOKEN_A, TOKEN_B]);
  console.log("Tx:", tx);
// 1. 获取"公共客户端"（可以理解为"区块链浏览器"）
  const publicClient = await connection.viem.getPublicClient();
  // // 2. 等待交易被区块链确认
  const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
  console.log("Confirmed in block:", receipt.blockNumber);

  const pairAddress = await factory.read.getPair([TOKEN_A, TOKEN_B]);
  console.log("Pair address:", pairAddress);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});