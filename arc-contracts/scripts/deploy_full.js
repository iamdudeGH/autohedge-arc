/**
 * scripts/deploy_full.js
 *
 * ONE-COMMAND full testnet setup. Run:
 *   npx hardhat run scripts/deploy_full.js --network arc_testnet
 *
 * What it does (in order):
 *   1. Deploys MockERC20 as "Mock WETH" (tokenIn  — the volatile asset)
 *   2. Deploys MockERC20 as "Mock USDC" (tokenOut — the stable asset)
 *   3. Deploys MockSwapRouter
 *   4. Deploys TreasuryRebalancer (with real constructor args)
 *   5. Mints 1000 WETH into the TreasuryRebalancer (simulates DAO holdings)
 *   6. Mints 2000 USDC into the MockSwapRouter  (so it can pay out swaps)
 *   7. Saves ALL addresses to deployed_address.txt AND updates arc-contracts/.env
 *   8. Prints a ready-to-paste block for the dashboard .env.local
 */

const hre  = require("hardhat");
const fs   = require("fs");
const path = require("path");

// ── Configuration ─────────────────────────────────────────────────────────────
const POOL_FEE      = 3000;   // 0.3 % — standard Uniswap V3 fee tier
const SLIPPAGE_BPS  = 200;    // 2 %   — max slippage protection

// Token amounts (in wei — 18 decimals)
const WETH_MINT_TO_TREASURY = hre.ethers.parseEther("1000"); // 1 000 WETH for DAO treasury
const USDC_MINT_TO_ROUTER   = hre.ethers.parseEther("2000"); // 2 000 USDC liquidity in router

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("\n🚀 AutoHedge Full Testnet Deployment");
  console.log("══════════════════════════════════════════");
  console.log("Deployer :", deployer.address);
  console.log("Network  :", hre.network.name);
  console.log("══════════════════════════════════════════\n");

  // ── Step 1: Deploy Mock WETH ────────────────────────────────────────────────
  process.stdout.write("1/6  Deploying Mock WETH (tokenIn)  ... ");
  const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
  const mockWETH  = await MockERC20.deploy("Mock Wrapped Ether", "mWETH", 18);
  await mockWETH.waitForDeployment();
  const wethAddr  = await mockWETH.getAddress();
  console.log(`✓  ${wethAddr}`);

  // ── Step 2: Deploy Mock USDC ────────────────────────────────────────────────
  process.stdout.write("2/6  Deploying Mock USDC (tokenOut) ... ");
  const mockUSDC = await MockERC20.deploy("Mock USD Coin", "mUSDC", 18);
  await mockUSDC.waitForDeployment();
  const usdcAddr = await mockUSDC.getAddress();
  console.log(`✓  ${usdcAddr}`);

  // ── Step 3: Deploy MockSwapRouter ───────────────────────────────────────────
  process.stdout.write("3/6  Deploying MockSwapRouter       ... ");
  const MockRouter = await hre.ethers.getContractFactory("MockSwapRouter");
  const mockRouter = await MockRouter.deploy();
  await mockRouter.waitForDeployment();
  const routerAddr = await mockRouter.getAddress();
  console.log(`✓  ${routerAddr}`);

  // ── Step 4: Deploy TreasuryRebalancer ───────────────────────────────────────
  process.stdout.write("4/6  Deploying TreasuryRebalancer   ... ");
  const Treasury = await hre.ethers.getContractFactory("TreasuryRebalancer");
  const treasury = await Treasury.deploy(
    routerAddr,
    wethAddr,
    usdcAddr,
    POOL_FEE,
    SLIPPAGE_BPS
  );
  await treasury.waitForDeployment();
  const treasuryAddr = await treasury.getAddress();
  console.log(`✓  ${treasuryAddr}`);

  // ── Step 5: Mint WETH into TreasuryRebalancer ───────────────────────────────
  process.stdout.write("5/6  Minting 1000 mWETH → Treasury  ... ");
  const mintWETH = await mockWETH.mint(treasuryAddr, WETH_MINT_TO_TREASURY);
  await mintWETH.wait();
  console.log("✓");

  // ── Step 6: Mint USDC into MockRouter (liquidity for swaps) ─────────────────
  process.stdout.write("6/6  Minting 2000 mUSDC → Router    ... ");
  const mintUSDC = await mockUSDC.mint(routerAddr, USDC_MINT_TO_ROUTER);
  await mintUSDC.wait();
  console.log("✓");

  // ── Save addresses ───────────────────────────────────────────────────────────
  const deployedData = {
    network:    hre.network.name,
    deployer:   deployer.address,
    treasury:   treasuryAddr,
    mockWETH:   wethAddr,
    mockUSDC:   usdcAddr,
    mockRouter: routerAddr,
    poolFee:    POOL_FEE,
    slippageBps: SLIPPAGE_BPS,
    deployedAt: new Date().toISOString(),
  };

  fs.writeFileSync(
    "deployed_address.txt",
    JSON.stringify(deployedData, null, 2),
    "utf8"
  );

  // Update arc-contracts .env with the treasury address
  let envContent = fs.existsSync(".env") ? fs.readFileSync(".env", "utf8") : "";
  if (envContent.includes("TREASURY_ADDRESS=")) {
    envContent = envContent.replace(/TREASURY_ADDRESS=.*/g, `TREASURY_ADDRESS="${treasuryAddr}"`);
  } else {
    envContent += `\nTREASURY_ADDRESS="${treasuryAddr}"\n`;
  }
  // Also add mock addresses for use by other scripts
  ["MOCK_WETH", "MOCK_USDC", "MOCK_ROUTER"].forEach((key, i) => {
    const val = [wethAddr, usdcAddr, routerAddr][i];
    if (envContent.includes(`${key}=`)) {
      envContent = envContent.replace(new RegExp(`${key}=.*`), `${key}="${val}"`);
    } else {
      envContent += `${key}="${val}"\n`;
    }
  });
  fs.writeFileSync(".env", envContent, "utf8");

  // ── Print summary ────────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════");
  console.log("✅  DEPLOYMENT COMPLETE");
  console.log("══════════════════════════════════════════");
  console.log(`TreasuryRebalancer : ${treasuryAddr}`);
  console.log(`Mock WETH          : ${wethAddr}`);
  console.log(`Mock USDC          : ${usdcAddr}`);
  console.log(`Mock SwapRouter    : ${routerAddr}`);
  console.log("\n📋  Paste this into genrebalancer-dashboard/.env.local:");
  console.log("──────────────────────────────────────────");
  console.log(`ARC_CONTRACT_ADDRESS=${treasuryAddr}`);
  console.log("──────────────────────────────────────────");
  console.log("\n📋  Paste this into genrebalancer-dashboard/src/app/config.js:");
  console.log("──────────────────────────────────────────");
  console.log(`export const ARC_CONTRACT_ADDRESS = "${treasuryAddr}";`);
  console.log("──────────────────────────────────────────");
  console.log("\n💾  All addresses saved to: arc-contracts/deployed_address.txt");
  console.log("    Run next: npx hardhat run scripts/set_relayer.js --network arc_testnet\n");
}

main().catch((error) => {
  console.error("\n❌ Deployment failed:", error);
  process.exitCode = 1;
});
