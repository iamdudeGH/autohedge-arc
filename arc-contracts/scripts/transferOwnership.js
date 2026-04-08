const { ethers } = require("hardhat");
const fs = require("fs");

async function main() {
  const ARC_CONTRACT_ADDRESS = "0x6A1d304F6A041d2975159C2625B50724b8DD18d2";
  
  // You need to paste the GenLayer Relayer Address here
  const GENLAYER_RELAYER_ADDRESS = "PASTE_RELAYER_ADDRESS_HERE";

  if (GENLAYER_RELAYER_ADDRESS === "PASTE_RELAYER_ADDRESS_HERE") {
    console.error("❌ Please edit this script and replace PASTE_RELAYER_ADDRESS_HERE with the GenLayer Relayer Address!");
    process.exit(1);
  }

  console.log(`Getting contract at: ${ARC_CONTRACT_ADDRESS}`);
  const TreasuryRebalancer = await ethers.getContractFactory("TreasuryRebalancer");
  const contract = TreasuryRebalancer.attach(ARC_CONTRACT_ADDRESS);

  const currentOwner = await contract.owner();
  console.log(`Current owner is: ${currentOwner}`);

  if (currentOwner.toLowerCase() === GENLAYER_RELAYER_ADDRESS.toLowerCase()) {
    console.log("✅ Ownership is already set to the GenLayer Relayer.");
    return;
  }

  console.log(`Transferring ownership to: ${GENLAYER_RELAYER_ADDRESS}...`);
  const tx = await contract.transferOwnership(GENLAYER_RELAYER_ADDRESS);
  console.log(`Tx submitted! Hash: ${tx.hash}`);
  
  await tx.wait();
  console.log("✅ Ownership successfully transferred!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
