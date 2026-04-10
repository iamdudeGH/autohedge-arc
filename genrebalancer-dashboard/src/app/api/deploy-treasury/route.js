/**
 * POST /api/deploy-treasury
 * Body: { walletAddress: "0xUserWallet" }
 *
 * Deploys a TreasuryRebalancerDemo contract on Arc Testnet for the given wallet.
 * The backend deployer pays the gas — the user needs no Arc testnet ETH.
 *
 * Steps:
 *   1. Validate the wallet address
 *   2. Check registry — if already deployed, return existing address (idempotent)
 *   3. Deploy TreasuryRebalancerDemo(owner=userWallet, relayer=backendWallet)
 *   4. Save mapping to registry (Vercel KV or local JSON)
 *   5. Return contract address
 *
 * ⚠️  ARC_PRIVATE_KEY is the backend deployer wallet key. Never sent to the browser.
 *
 * Response:
 *   { success: true, contractAddress: "0x...", txHash: "0x...", alreadyExisted: bool }
 */

import { NextResponse }  from 'next/server';
import { ethers }        from 'ethers';
import { getTreasury, setTreasury } from '@/lib/registry';

import artifact     from '@/contracts/TreasuryRebalancer.json';
import erc20Artifact from '@/contracts/MockERC20.json';

// These addresses are fixed for the demo environment based on the deployed mock assets
const MOCK_WETH   = "0xa48d06a3E9df191B84dbb4402c63E9E439e9e828";
const MOCK_USDC   = "0xe1283D7724C82593013a8CFd40141789E294874E";
const MOCK_ROUTER = "0xc18f4EE8117FB2a2b9D670B6c80Bf6c2cEe1F69b";
const POOL_FEE    = 3000;
const SLIPPAGE    = 200;

export const maxDuration = 60; // seconds — needed for Vercel serverless

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { walletAddress } = body;

  if (!walletAddress || !/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) {
    return NextResponse.json({ error: 'Invalid walletAddress.' }, { status: 400 });
  }

  const existing = await getTreasury(walletAddress);
  if (existing) {
    return NextResponse.json({
      success:       true,
      contractAddress: existing,
      alreadyExisted:  true,
    });
  }

  const arcPrivateKey = process.env.ARC_PRIVATE_KEY;
  const arcRpcUrl     = process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network';

  if (!arcPrivateKey) {
    return NextResponse.json({ error: 'Server config error: ARC_PRIVATE_KEY not set' }, { status: 500 });
  }

  try {
    const provider = new ethers.JsonRpcProvider(arcRpcUrl);
    const deployer = new ethers.Wallet(arcPrivateKey, provider);
    
    // 1. Deploy the real TreasuryRebalancer.sol
    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);
    console.log(`[deploy-treasury] Deploying REAL swap contract for: ${walletAddress}`);

    const contract = await factory.deploy(
      MOCK_ROUTER,
      MOCK_WETH,
      MOCK_USDC,
      POOL_FEE,
      SLIPPAGE,
      deployer.address
    );

    const deployTx = contract.deploymentTransaction();
    const contractAddress = await contract.getAddress();
    await contract.waitForDeployment();
    
    console.log(`[deploy-treasury] Deployed at: ${contractAddress}`);

    // 2. Fund the new treasury with 1,000 WETH mock tokens!
    console.log(`[deploy-treasury] Funding treasury with Mock WETH...`);
    const wethContract = new ethers.Contract(MOCK_WETH, erc20Artifact.abi, deployer);
    const mintTx = await wethContract.mint(contractAddress, ethers.parseEther("1000"));
    await mintTx.wait();

    // 2.5 Fund the Mock Router with 1,000,000 Mock USDC so swaps never fail with insufficient balance
    console.log(`[deploy-treasury] Funding router with Mock USDC for liquidity...`);
    const usdcContract = new ethers.Contract(MOCK_USDC, erc20Artifact.abi, deployer);
    const routerMintTx = await usdcContract.mint(MOCK_ROUTER, ethers.parseUnits("1000000", 18));
    await routerMintTx.wait();

    // 3. Transfer treasury ownership to the user
    console.log(`[deploy-treasury] Transferring ownership to the user...`);
    const transferTx = await contract.transferOwnership(walletAddress);
    await transferTx.wait();

    // 4. Save to upstash redis
    await setTreasury(walletAddress, contractAddress);

    return NextResponse.json({
      success:         true,
      contractAddress,
      txHash:          deployTx?.hash,
      alreadyExisted:  false,
    });

  } catch (e) {
    console.error('[deploy-treasury] Deployment failed:', e);
    return NextResponse.json(
      { error: e.shortMessage ?? e.message ?? 'Deployment failed' },
      { status: 500 }
    );
  }
}
