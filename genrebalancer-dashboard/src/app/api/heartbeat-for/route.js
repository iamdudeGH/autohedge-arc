/**
 * POST /api/heartbeat-for
 * Body: { treasuryAddress: "0xDemoContract", userWallet: "0xUserWallet" }
 *
 * Runs a full AI heartbeat cycle for the user's personal demo treasury:
 *   1. Calls heartbeat_for(treasuryAddress) on the GenLayer Intelligent Contract
 *   2. Waits for multi-validator AI consensus (~15-60 seconds)
 *   3. Reads the resulting audit log entry
 *   4. ALWAYS submits a rebalance() tx to the user's demo Arc contract:
 *        - SAFE    → rebalance(0, "SAFE")       — records the safe heartbeat on-chain
 *        - CAUTION → rebalance(percentBps, "CAUTION") — partial simulated swap
 *        - CRITICAL→ rebalance(percentBps, "CRITICAL") — full simulated swap
 *   5. Returns riskScore, signal, reasoning, and the Arc tx hash + explorer link
 *
 * Response:
 *   {
 *     success: true,
 *     action: "HEARTBEAT_SAFE" | "TRADE_EXECUTED",
 *     riskScore: 0.23,
 *     marketSignal: "SAFE",
 *     reasoning: "...",
 *     arcTxHash: "0x...",
 *     explorerUrl: "https://testnet.arcscan.app/tx/0x...",
 *     glTxHash: "0x..."
 *   }
 */

import { NextResponse } from 'next/server';
import { ethers }       from 'ethers';

export const maxDuration = 60; // Vercel: allow up to 60s for GenLayer consensus

// ── ABI for the demo treasury's rebalance() ────────────────────────────────
const DEMO_TREASURY_ABI = [
  'function rebalance(uint256 percentBps, string signal) returns (bool)',
  'event RebalanceExecuted(address indexed userWallet, uint256 percentBps, uint256 amountSimulated, string signal)',
  'function getInfo() view returns (address _owner, address _relayer, uint256 _weth, uint256 _usdc, uint256 _rebalances)',
];

const GENLAYER_CONTRACT =
  process.env.GENLAYER_CONTRACT_ADDRESS ||
  '0x30C0e23273881c0b1a144d66187cCB798c22D11A';

const ARC_EXPLORER_URL = 'https://testnet.arcscan.app';

function log(level, msg) {
  console.log(`[${new Date().toISOString()}] [heartbeat-for] [${level}] ${msg}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function POST(request) {
  // ── Validate body ──────────────────────────────────────────────────────────
  let body;
  try { body = await request.json(); }
  catch { return err(400, 'Invalid JSON body'); }

  const { treasuryAddress, userWallet } = body;

  if (!treasuryAddress || !/^0x[0-9a-fA-F]{40}$/.test(treasuryAddress)) {
    return err(400, 'Invalid treasuryAddress');
  }
  if (!userWallet || !/^0x[0-9a-fA-F]{40}$/.test(userWallet)) {
    return err(400, 'Invalid userWallet');
  }

  // ── Validate server secrets ────────────────────────────────────────────────
  const glBurnerKey   = process.env.NEXT_PUBLIC_GL_BURNER_KEY;
  const arcPrivateKey = process.env.ARC_PRIVATE_KEY;
  const arcRpcUrl     = process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network';

  if (!glBurnerKey)   return err(500, 'Missing NEXT_PUBLIC_GL_BURNER_KEY');
  if (!arcPrivateKey) return err(500, 'Missing ARC_PRIVATE_KEY');

  // ── Step 1: Import genlayer-js (dynamic — avoids SSR issues) ──────────────
  log('INFO', `Starting heartbeat for treasury: ${treasuryAddress}`);
  let createClient, createAccount, studionet, DECIDED_STATES;
  try {
    ({ createClient, createAccount } = await import('genlayer-js'));
    ({ studionet }                   = await import('genlayer-js/chains'));
    ({ DECIDED_STATES }              = await import('genlayer-js/types'));
  } catch (e) {
    return err(500, `Failed to load genlayer-js: ${e.message}`);
  }

  const glAccount     = createAccount(glBurnerKey);
  const glWriteClient = createClient({ chain: studionet, account: glAccount });
  const glReadClient  = createClient({ chain: studionet });

  // ── Step 2: Submit heartbeat_for on GenLayer ───────────────────────────────
  log('INFO', 'Submitting heartbeat_for to GenLayer...');
  let glTxHash;
  try {
    glTxHash = await glWriteClient.writeContract({
      address:      GENLAYER_CONTRACT,
      functionName: 'heartbeat_for',
      args:         [treasuryAddress],
    });
  } catch (e) {
    log('ERROR', `GenLayer write failed: ${e.message}`);
    return err(500, `GenLayer call failed: ${e.message}`);
  }
  log('INFO', `GenLayer tx: ${glTxHash}`);

  // ── Step 3: Poll for consensus (max 50s — stays under Vercel's 60s limit) ──
  log('INFO', 'Polling for consensus...');
  for (let i = 0; i < 25; i++) {
    await sleep(2000);
    try {
      const receipt = await glWriteClient.getTransaction({ hash: glTxHash });
      if (receipt && DECIDED_STATES.includes(receipt.status)) {
        log('INFO', `Consensus reached after ${(i + 1) * 2}s (status: ${receipt.status})`);
        break;
      }
    } catch { /* still pending */ }
  }

  // ── Step 4: Read audit logs to get the AI decision ────────────────────────
  log('INFO', 'Reading audit logs from GenLayer...');
  let latestLog = null;
  try {
    const raw  = await glReadClient.readContract({
      address:      GENLAYER_CONTRACT,
      functionName: 'get_audit_logs',
      args:         [],
    });
    const logs = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (logs.length > 0) {
      const last = logs[logs.length - 1];
      latestLog  = typeof last === 'string' ? JSON.parse(last) : last;
    }
  } catch (e) {
    log('WARN', `Could not read audit logs: ${e.message}`);
  }

  // Extract AI decision fields (with safe defaults if log missing)
  const riskScore    = latestLog?.actual_risk ?? latestLog?.ai_decision?.risk_score ?? 0;
  const marketSignal = latestLog?.ai_decision?.market_signal ?? 'SAFE';
  const reasoning    = latestLog?.ai_decision?.reasoning ?? 'Analysis complete.';
  const speedLimit   = latestLog?.speed_limit_applied ?? 25;

  // Convert speed limit % to basis points for the rebalance call
  // SAFE = 0 bps (records heartbeat but no simulated swap)
  const isTradeAuthorized = latestLog?.action === 'TRADE_AUTHORIZED';
  const percentBps = isTradeAuthorized ? Math.round(speedLimit * 100) : 0;

  log('INFO', `AI decision: ${marketSignal} | riskScore: ${riskScore} | percentBps: ${percentBps}`);

  // ── Step 5: Submit Arc tx to the user's demo treasury ─────────────────────
  log('INFO', `Submitting rebalance(${percentBps}, "${marketSignal}") to demo contract...`);
  let arcTxHash;
  let blockNumber;
  try {
    const provider = new ethers.JsonRpcProvider(arcRpcUrl);
    const wallet   = new ethers.Wallet(arcPrivateKey, provider);
    const contract = new ethers.Contract(treasuryAddress, DEMO_TREASURY_ABI, wallet);

    const tx    = await contract.rebalance(percentBps, marketSignal);
    arcTxHash   = tx.hash;
    log('INFO', `Arc tx submitted: ${arcTxHash}`);

    const receipt = await tx.wait(1);
    blockNumber   = receipt.blockNumber;
    log('INFO', `Arc tx confirmed in block ${blockNumber}`);

  } catch (e) {
    log('ERROR', `Arc relay failed: ${e.message}`);
    // Return the GL decision even if Arc failed
    return NextResponse.json({
      success:      false,
      glTxHash,
      riskScore,
      marketSignal,
      reasoning,
      error:        `Arc relay failed: ${e.shortMessage ?? e.message}`,
    }, { status: 500 });
  }

  // ── Success ────────────────────────────────────────────────────────────────
  return NextResponse.json({
    success:     true,
    action:      isTradeAuthorized ? 'TRADE_EXECUTED' : 'HEARTBEAT_SAFE',
    glTxHash,
    arcTxHash,
    blockNumber,
    explorerUrl: `${ARC_EXPLORER_URL}/tx/${arcTxHash}`,
    riskScore,
    marketSignal,
    reasoning,
    percentBps,
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function err(status, message) {
  console.error(`[heartbeat-for] ${message}`);
  return NextResponse.json({ success: false, error: message }, { status });
}
