// 部署修复版 Router（reserveA==0 时直接使用期望值，不再 revert）
import hre from "hardhat";

const FACTORY = "0xadf01b65647cfb61c416ce6e23c1f61375fa2f9a";

async function main() {
  const connection = await hre.network.connect();
  const [deployer] = await connection.viem.getWalletClients();
  console.log("Deployer:", deployer.account.address);

  const Router = await connection.viem.deployContract("DefiRouter", [FACTORY]);
  console.log("\n新 Router 部署成功!");
  console.log("地址:", Router.address);

  console.log("\n===== 请更新 .env =====");
  console.log(`NEXT_PUBLIC_ROUTER_ADDRESS=${Router.address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});