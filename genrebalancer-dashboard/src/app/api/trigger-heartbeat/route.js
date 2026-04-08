/**
 * POST /api/trigger-heartbeat
 *
 * Server-side backend relayer — acts as the autonomous cross-chain bridge
 * between GenLayer consensus and the Arc Network.
 *
 * The Arc private key NEVER leaves the server. It is loaded exclusively from
 * `.env.local` and is never exposed to the browser bundle.
 *
 * Body: { speedLimit: number, marketSignal: string }
 * Returns: { success: boolean, txHash?: string, error?: string }
 */

import { NextResponse } from 'next/server';
import { ethers } from 'ethers';

// Minimal ABI — only the functions this relayer needs
const TREASURY_ABI = [
  "function rebalance(uint256 percentBps, string signal) returns (bool)",
  "event RebalanceExecuted(address indexed caller, uint256 amountIn, uint256 amountOut, string signal)",
];

export async function POST(request) {
  try {
    const body = await request.json();
    const { speedLimit, marketSignal } = body;

    // ── Validate inputs ─────────────────────────────────────────────────────
    if (typeof speedLimit !== 'number' || speedLimit <= 0 || speedLimit > 100) {
      return NextResponse.json(
        { success: false, error: 'Invalid speedLimit. Must be a number between 1 and 100.' },
        { status: 400 }
      );
    }
    if (typeof marketSignal !== 'string' || !marketSignal.trim()) {
      return NextResponse.json(
        { success: false, error: 'Invalid marketSignal. Must be a non-empty string.' },
        { status: 400 }
      );
    }

    // ── Load server-side secrets ────────────────────────────────────────────
    const arcPrivateKey     = process.env.ARC_PRIVATE_KEY;
    const arcRpcUrl         = process.env.ARC_RPC_URL        || 'https://rpc.testnet.arc.network';
    const arcContractAddr   = process.env.ARC_CONTRACT_ADDRESS;

    if (!arcPrivateKey) {
      console.error('[Relayer] ARC_PRIVATE_KEY is not set in .env.local');
      return NextResponse.json(
        { success: false, error: 'Server configuration error: missing ARC_PRIVATE_KEY.' },
        { status: 500 }
      );
    }
    if (!arcContractAddr) {
      console.error('[Relayer] ARC_CONTRACT_ADDRESS is not set in .env.local');
      return NextResponse.json(
        { success: false, error: 'Server configuration error: missing ARC_CONTRACT_ADDRESS.' },
        { status: 500 }
      );
    }

    // ── Connect to Arc Network ──────────────────────────────────────────────
    const provider = new ethers.JsonRpcProvider(arcRpcUrl);
    const wallet   = new ethers.Wallet(arcPrivateKey, provider);
    const contract = new ethers.Contract(arcContractAddr, TREASURY_ABI, wallet);

    // Convert the speed-limit percentage (1–100) to basis points (100–10000)
    const percentBps = Math.round(speedLimit * 100);

    console.log(
      `[Relayer] Submitting rebalance — percentBps: ${percentBps}, signal: ${marketSignal}`
    );

    // ── Submit transaction ──────────────────────────────────────────────────
    const tx = await contract.rebalance(percentBps, marketSignal.trim());

    console.log(`[Relayer] Tx submitted: ${tx.hash}`);

    // Wait for 1 confirmation before responding
    const receipt = await tx.wait(1);

    console.log(`[Relayer] Tx confirmed in block ${receipt.blockNumber}`);

    return NextResponse.json({
      success:     true,
      txHash:      tx.hash,
      blockNumber: receipt.blockNumber,
    });

  } catch (err) {
    console.error('[Relayer] Error:', err);
    return NextResponse.json(
      {
        success: false,
        error:   err.shortMessage ?? err.message ?? 'Unknown server error',
      },
      { status: 500 }
    );
  }
}
