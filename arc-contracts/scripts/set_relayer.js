/**
 * scripts/set_relayer.js
 *
 * Step 3 — Set the GenLayer relayer address on the TreasuryRebalancer.
 *
 * Run AFTER deploy_full.js:
 *   npx hardhat run scripts/set_relayer.js --network arc_testnet
 *
 * The RELAYER_ADDRESS is read from arc-contracts/.env.
 * If not set yet, it defaults to the deployer address (useful for testing).
 *
 * What "relayer" means:
 *   The relayer is the wallet whose PRIVATE KEY is in the dashboard's
 *   .env.local as ARC_PRIVATE_KEY.  It's the only address (besides the owner)
 *   allowed to call rebalance() on the Arc contract.
 */

require("dotenv").config();
const hre  = require("hardhat");
const fs   = require("fs");

const TREASURY_ABI = [
  "function owner() view returns (address)",
  "function relayer() view returns (address)",
  "function setRelayer(address newRelayer) external",
];

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  // ── Read contracts ───────────────────────────────────────────────────────────
  let deployedData;
  try {
    deployedData = JSON.parse(fs.readFileSync("deployed_address.txt", "utf8"));
  } catch {
    console.error(
      "❌ deployed_address.txt not found. Run deploy_full.js first."
    );
    process.exit(1);
  }

  const treasuryAddr = deployedData.treasury;
  if (!treasuryAddr) {
    console.error("❌ No treasury address in deployed_address.txt.");
    process.exit(1);
  }

  // ── Determine relayer address ────────────────────────────────────────────────
  // RELAYER_ADDRESS in .env = the wallet whose key lives in dashboard/.env.local
  // as ARC_PRIVATE_KEY.  If not set, we default to the deployer (fine for testing).
  const relayerAddr = process.env.RELAYER_ADDRESS || deployer.address;

  const provider = hre.ethers.provider;
  const treasury  = new hre.ethers.Contract(treasuryAddr, TREASURY_ABI, deployer);

  const currentRelayer = await treasury.relayer();
  const owner          = await treasury.owner();

  console.log("\n🔑 AutoHedge — Set Relayer");
  console.log("══════════════════════════════════════════");
  console.log("Treasury          :", treasuryAddr);
  console.log("Contract owner    :", owner);
  console.log("Current relayer   :", currentRelayer);
  console.log("New relayer target:", relayerAddr);
  console.log("Me (deployer)     :", deployer.address);
  console.log("══════════════════════════════════════════\n");

  if (currentRelayer.toLowerCase() === relayerAddr.toLowerCase()) {
    console.log("✅ Relayer is already set to the correct address. Nothing to do.");
    return;
  }

  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    console.error(
      `❌ You are not the owner.\n   Owner: ${owner}\n   You  : ${deployer.address}`
    );
    process.exit(1);
  }

  process.stdout.write(`Setting relayer to ${relayerAddr} ... `);
  const tx = await treasury.setRelayer(relayerAddr);
  await tx.wait();
  console.log("✓");

  // Verify
  const newRelayer = await treasury.relayer();
  console.log("\n✅ Relayer successfully updated!");
  console.log("   Confirmed relayer:", newRelayer);
  console.log("\n📋  Make sure your dashboard .env.local has:");
  console.log(`   ARC_PRIVATE_KEY=<private key of ${relayerAddr}>\n`);
}

main().catch((error) => {
  console.error("\n❌ set_relayer failed:", error);
  process.exitCode = 1;
});
