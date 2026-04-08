/**
 * POST /api/run-full-heartbeat
 *
 * A single server-side endpoint that runs the ENTIRE autonomous loop:
 *   1. Calls heartbeat() on the GenLayer Intelligent Contract
 *   2. Waits for AI consensus (~15-30 seconds)
 *   3. Reads the resulting audit log
 *   4. If the AI authorised a trade → signs & submits rebalance() on Arc
 *
 * Called by: heartbeat-cron.js (autonomous cron)
 *
 * All secrets (GL burner key, Arc private key) live in .env.local ONLY.
 * Nothing sensitive is sent to or from the browser for this route.
 */

import { NextResponse } from 'next/server';
import { ethers }       from 'ethers';

// ── Config ────────────────────────────────────────────────────────────────────
const GENLAYER_CONTRACT = process.env.GENLAYER_CONTRACT_ADDRESS
  || "0xB4f499b1C55E33F74Ef293B8EB396e29951739AC";

const TREASURY_ABI = [
  "function rebalance(uint256 percentBps, string signal) returns (bool)",
];

function log(level, msg) {
  console.log(`[${new Date().toISOString()}] [run-full-heartbeat] [${level}] ${msg}`);
}

export async function POST() {
  // ── 1. Validate secrets ────────────────────────────────────────────────────
  const glBurnerKey     = process.env.NEXT_PUBLIC_GL_BURNER_KEY;
  const arcPrivateKey   = process.env.ARC_PRIVATE_KEY;
  const arcContractAddr = process.env.ARC_CONTRACT_ADDRESS;
  const arcRpcUrl       = process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network';

  if (!glBurnerKey)     return err('Missing NEXT_PUBLIC_GL_BURNER_KEY in .env.local');
  if (!arcPrivateKey)   return err('Missing ARC_PRIVATE_KEY in .env.local');
  if (!arcContractAddr) return err('Missing ARC_CONTRACT_ADDRESS in .env.local');

  // ── 2. Submit GenLayer heartbeat ───────────────────────────────────────────
  log('INFO', 'Importing genlayer-js...');
  let createClient, createAccount, studionet, DECIDED_STATES;
  try {
    ({ createClient, createAccount } = await import('genlayer-js'));
    ({ studionet }                   = await import('genlayer-js/chains'));
    ({ DECIDED_STATES }              = await import('genlayer-js/types'));
  } catch (e) {
    return err(`Failed to load genlayer-js: ${e.message}`);
  }

  const glAccount     = createAccount(glBurnerKey);
  const glWriteClient = createClient({ chain: studionet, account: glAccount });
  const glReadClient  = createClient({ chain: studionet });

  log('INFO', 'Submitting heartbeat to GenLayer...');
  let txHash;
  try {
    txHash = await glWriteClient.writeContract({
      address:      GENLAYER_CONTRACT,
      functionName: 'heartbeat',
      args:         [],
    });
  } catch (e) {
    return err(`GenLayer writeContract failed: ${e.message}`);
  }
  log('INFO', `GenLayer tx submitted: ${txHash}`);

  // ── 3. Wait for consensus ──────────────────────────────────────────────────
  log('INFO', 'Waiting for consensus...');
  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    try {
      const receipt = await glWriteClient.getTransaction({ hash: txHash });
      if (receipt && DECIDED_STATES.includes(receipt.status)) {
        log('INFO', `Consensus reached (status: ${receipt.status})`);
        break;
      }
    } catch { /* still pending */ }
  }

  // ── 4. Read audit logs ─────────────────────────────────────────────────────
  log('INFO', 'Reading audit logs...');
  let latestLog = null;
  try {
    const raw       = await glReadClient.readContract({
      address:      GENLAYER_CONTRACT,
      functionName: 'get_audit_logs',
      args:         [],
    });
    const logs      = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (logs.length > 0) {
      const last = logs[logs.length - 1];
      latestLog  = typeof last === 'string' ? JSON.parse(last) : last;
    }
  } catch (e) {
    log('WARN', `Could not read audit logs: ${e.message}`);
  }

  if (!latestLog) {
    return NextResponse.json({ success: true, action: 'NO_LOG', glTxHash: txHash });
  }
  log('INFO', `AI decision: ${latestLog.action} — ${latestLog.ai_decision?.reasoning}`);

  // ── 5. If SAFE, return early — no Arc tx needed ────────────────────────────
  if (latestLog.action !== 'TRADE_AUTHORIZED') {
    return NextResponse.json({
      success:   true,
      action:    latestLog.action,
      reasoning: latestLog.ai_decision?.reasoning,
      riskScore: latestLog.actual_risk,
      glTxHash:  txHash,
    });
  }

  // ── 6. AI authorised → relay to Arc ───────────────────────────────────────
  log('INFO', 'Trade authorised — relaying to Arc Network...');
  const percentBps = Math.round((latestLog.speed_limit_applied ?? 25) * 100);
  const signal     = latestLog.ai_decision?.market_signal ?? 'CRITICAL';

  try {
    const provider = new ethers.JsonRpcProvider(arcRpcUrl);
    const wallet   = new ethers.Wallet(arcPrivateKey, provider);
    const contract = new ethers.Contract(arcContractAddr, TREASURY_ABI, wallet);

    const tx      = await contract.rebalance(percentBps, signal);
    log('INFO', `Arc tx submitted: ${tx.hash}`);
    const receipt = await tx.wait(1);
    log('INFO', `Arc tx confirmed in block ${receipt.blockNumber}`);

    return NextResponse.json({
      success:     true,
      action:      'TRADE_EXECUTED',
      glTxHash:    txHash,
      arcTxHash:   tx.hash,
      blockNumber: receipt.blockNumber,
      percentBps,
      signal,
      reasoning:   latestLog.ai_decision?.reasoning,
      riskScore:   latestLog.actual_risk,
    });

  } catch (e) {
    log('ERROR', `Arc relay failed: ${e.message}`);
    return NextResponse.json(
      { success: false, action: 'RELAY_FAILED', glTxHash: txHash, error: e.shortMessage ?? e.message },
      { status: 500 }
    );
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function err(msg) {
  console.error(`[run-full-heartbeat] ERROR: ${msg}`);
  return NextResponse.json({ success: false, error: msg }, { status: 500 });
}
