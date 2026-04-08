/**
 * scripts/setup_env.js
 *
 * Step 4 — Generate a fresh Arc relayer wallet and automatically write it to:
 *   - arc-contracts/.env          (PRIVATE_KEY for Hardhat)
 *   - genrebalancer-dashboard/.env.local  (ARC_PRIVATE_KEY for the backend relayer)
 *
 * Run:
 *   node scripts/setup_env.js
 *
 * ⚠️  Keep the generated private key secret. Never commit .env or .env.local to git.
 */

const { ethers } = require("ethers");
const fs         = require("fs");
const path       = require("path");
const readline   = require("readline");

const DASHBOARD_ENV = path.resolve(
  __dirname,
  "../../genrebalancer-dashboard/.env.local"
);
const ARC_ENV       = path.resolve(__dirname, "../.env");

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

function updateEnvKey(filePath, key, value) {
  let content = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  const regex = new RegExp(`^${key}=.*`, "m");
  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`);
  } else {
    content += `\n${key}=${value}`;
  }
  fs.writeFileSync(filePath, content.trimStart(), "utf8");
}

async function main() {
  console.log("\n🔐 AutoHedge — Relayer Wallet Setup");
  console.log("══════════════════════════════════════════");

  const choice = await ask(
    "Do you want to:\n  [1] Generate a NEW relayer wallet\n  [2] Enter an EXISTING private key\nChoice [1/2]: "
  );

  let wallet;
  if (choice === "2") {
    const rawKey = await ask("Paste your existing private key (0x...): ");
    try {
      wallet = new ethers.Wallet(rawKey.trim());
    } catch (e) {
      console.error("❌ Invalid private key:", e.message);
      process.exit(1);
    }
    console.log(`\n✓  Using existing wallet: ${wallet.address}`);
  } else {
    wallet = ethers.Wallet.createRandom();
    console.log(`\n✓  Generated new wallet: ${wallet.address}`);
  }

  const privateKey = wallet.privateKey;

  // ── Write to arc-contracts/.env ─────────────────────────────────────────────
  updateEnvKey(ARC_ENV, "PRIVATE_KEY", privateKey);
  updateEnvKey(ARC_ENV, "RELAYER_ADDRESS", `"${wallet.address}"`);
  console.log(`\n✓  Written to  arc-contracts/.env`);
  console.log(`   PRIVATE_KEY    = ${privateKey.slice(0, 10)}...`);
  console.log(`   RELAYER_ADDRESS = ${wallet.address}`);

  // ── Write to dashboard .env.local ───────────────────────────────────────────
  updateEnvKey(DASHBOARD_ENV, "ARC_PRIVATE_KEY", privateKey);
  console.log(`\n✓  Written to  genrebalancer-dashboard/.env.local`);
  console.log(`   ARC_PRIVATE_KEY = ${privateKey.slice(0, 10)}...`);

  console.log("\n══════════════════════════════════════════");
  console.log("✅  Env setup complete!");
  console.log("\n⚠️  IMPORTANT:");
  console.log(`   Fund this address with ARC testnet gas before deploying:`);
  console.log(`   👛 ${wallet.address}`);
  console.log("   Get testnet ARC from: https://faucet.arc.network");
  console.log("\n   Run next:");
  console.log("   npx hardhat run scripts/deploy_full.js --network arc_testnet\n");
}

main().catch(err => { console.error(err); process.exit(1); });
