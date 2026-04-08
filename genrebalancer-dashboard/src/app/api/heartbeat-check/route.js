/**
 * POST /api/heartbeat-check
 * Body: { glTxHash: "0x...", treasuryAddress: "0xDemoContract" }
 *
 * STEP 2 of 2: Checks if the GenLayer transaction has reached consensus.
 *
 * - If NOT yet decided: returns { decided: false } quickly (~1-2s)
 * - If decided: reads the AI decision, submits rebalance() to the user's
 *   Arc demo contract, and returns the full result.
 *
 * The client polls this endpoint every 3 seconds until decided=true.
 * Each individual call is fast — no timeout issues on Vercel free tier.
 *
 * Response (not decided):
 *   { decided: false }
 *
 * Response (decided):
 *   {
 *     decided: true, success: true,
 *     action: "HEARTBEAT_SAFE" | "TRADE_EXECUTED",
 *     riskScore: 0.23, marketSignal: "SAFE", reasoning: "...",
 *     arcTxHash: "0x...", explorerUrl: "https://...", glTxHash: "0x..."
 *   }
 */

import { NextResponse } from 'next/server';
import { ethers }       from 'ethers';

const GENLAYER_CONTRACT =
  process.env.GENLAYER_CONTRACT_ADDRESS ||
  '0x30C0e23273881c0b1a144d66187cCB798c22D11A';

const ARC_EXPLORER_URL = 'https://testnet.arcscan.app';

const DEMO_TREASURY_ABI = [
  'function rebalance(uint256 percentBps, string signal) returns (bool)',
];

function log(msg) {
  console.log(`[${new Date().toISOString()}] [heartbeat-check] ${msg}`);
}

export async function POST(request) {
  let body;
  try { body = await request.json(); }
  catch { return err(400, 'Invalid JSON body'); }

  const { glTxHash, treasuryAddress } = body;

  if (!glTxHash || !treasuryAddress) {
    return err(400, 'Missing glTxHash or treasuryAddress');
  }

  const glBurnerKey   = process.env.NEXT_PUBLIC_GL_BURNER_KEY;
  const arcPrivateKey = process.env.ARC_PRIVATE_KEY;
  const arcRpcUrl     = process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network';

  if (!glBurnerKey)   return err(500, 'Missing NEXT_PUBLIC_GL_BURNER_KEY');
  if (!arcPrivateKey) return err(500, 'Missing ARC_PRIVATE_KEY');

  // Dynamic imports
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

  // ── Check if GenLayer tx has reached consensus ─────────────────────────────
  let receipt;
  try {
    receipt = await glWriteClient.getTransaction({ hash: glTxHash });
  } catch (e) {
    log(`getTransaction failed: ${e.message}`);
    return NextResponse.json({ decided: false });
  }

  // Not decided yet — tell the client to keep polling
  if (!receipt || !DECIDED_STATES.includes(receipt.status)) {
    log(`Not decided yet (status: ${receipt?.status ?? 'unknown'})`);
    return NextResponse.json({ decided: false });
  }

  log(`Consensus reached! Status: ${receipt.status}`);

  // ── Consensus reached — read AI decision from audit logs ───────────────────
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
    log(`Could not read audit logs: ${e.message}`);
  }

  const riskScore    = latestLog?.actual_risk ?? latestLog?.ai_decision?.risk_score ?? 0;
  const marketSignal = latestLog?.ai_decision?.market_signal ?? 'SAFE';
  const reasoning    = latestLog?.ai_decision?.reasoning ?? 'AI analysis complete.';
  const speedLimit   = latestLog?.speed_limit_applied ?? 25;

  const isTradeAuthorized = latestLog?.action === 'TRADE_AUTHORIZED';
  const percentBps = isTradeAuthorized ? Math.round(speedLimit * 100) : 0;

  log(`AI decision: ${marketSignal} | risk: ${riskScore} | percentBps: ${percentBps}`);

  // ── Submit Arc tx to user's demo contract ──────────────────────────────────
  let arcTxHash, blockNumber;
  try {
    const provider = new ethers.JsonRpcProvider(arcRpcUrl);
    const wallet   = new ethers.Wallet(arcPrivateKey, provider);
    const contract = new ethers.Contract(treasuryAddress, DEMO_TREASURY_ABI, wallet);

    const tx  = await contract.rebalance(percentBps, marketSignal);
    arcTxHash = tx.hash;
    log(`Arc tx submitted: ${arcTxHash}`);

    const arcReceipt = await tx.wait(1);
    blockNumber      = arcReceipt.blockNumber;
    log(`Arc tx confirmed in block ${blockNumber}`);

  } catch (e) {
    log(`Arc relay failed: ${e.message}`);
    // Return AI result even if Arc failed
    return NextResponse.json({
      decided:      true,
      success:      false,
      glTxHash,
      riskScore,
      marketSignal,
      reasoning,
      error:        `AI decision received, but Arc relay failed: ${e.shortMessage ?? e.message}`,
    });
  }

  // ── Full success ───────────────────────────────────────────────────────────
  return NextResponse.json({
    decided:     true,
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

function err(status, message) {
  console.error(`[heartbeat-check] ERROR: ${message}`);
  return NextResponse.json({ success: false, error: message }, { status });
}
