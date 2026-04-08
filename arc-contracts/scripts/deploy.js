const hre = require("hardhat");

async function main() {
  const contract = await hre.ethers.deployContract("TreasuryRebalancer");

  await contract.waitForDeployment();

  console.log(
    `TreasuryRebalancer deployed to ${contract.target}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
