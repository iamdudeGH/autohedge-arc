const hre = require("hardhat");
const fs = require("fs");

async function main() {
  const contract = await hre.ethers.deployContract("TreasuryRebalancer");
  await contract.waitForDeployment();

  const address = contract.target;
  const output = `TreasuryRebalancer deployed to: ${address}`;
  console.log(output);
  
  // Also write to a file so we can read it reliably
  fs.writeFileSync("deployed_address.txt", address, "utf8");
  console.log("Address saved to deployed_address.txt");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
