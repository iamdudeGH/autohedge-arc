/**
 * POST /api/heartbeat-start
 * Body: { treasuryAddress: "0xDemoContract", userWallet: "0xUserWallet" }
 *
 * STEP 1 of 2: Submits the heartbeat_for() transaction to GenLayer and
 * returns the tx hash IMMEDIATELY (~2-4 seconds).
 *
 * The client then polls /api/heartbeat-check with the returned txHash
 * until consensus is reached and the Arc tx is submitted.
 *
 * Splitting avoids Vercel's 60-second serverless function timeout.
 *
 * Response: { glTxHash: "0x..." }
 */

import { NextResponse } from 'next/server';

const GENLAYER_CONTRACT =
  process.env.GENLAYER_CONTRACT_ADDRESS ||
  '0x30C0e23273881c0b1a144d66187cCB798c22D11A';

export async function POST(request) {
  let body;
  try { body = await request.json(); }
  catch { return err(400, 'Invalid JSON body'); }

  const { treasuryAddress } = body;

  if (!treasuryAddress || !/^0x[0-9a-fA-F]{40}$/.test(treasuryAddress)) {
    return err(400, 'Invalid treasuryAddress');
  }

  const glBurnerKey = process.env.NEXT_PUBLIC_GL_BURNER_KEY;
  if (!glBurnerKey) return err(500, 'Missing NEXT_PUBLIC_GL_BURNER_KEY');

  // Dynamic import to avoid SSR issues
  let createClient, createAccount, studionet;
  try {
    ({ createClient, createAccount } = await import('genlayer-js'));
    ({ studionet }                   = await import('genlayer-js/chains'));
  } catch (e) {
    return err(500, `Failed to load genlayer-js: ${e.message}`);
  }

  const glAccount     = createAccount(glBurnerKey);
  const glWriteClient = createClient({ chain: studionet, account: glAccount });

  console.log(`[heartbeat-start] Submitting heartbeat_for(${treasuryAddress})`);

  try {
    const glTxHash = await glWriteClient.writeContract({
      address:      GENLAYER_CONTRACT,
      functionName: 'heartbeat',  // Uses the already-deployed method
      args:         [],
    });

    console.log(`[heartbeat-start] Submitted: ${glTxHash}`);

    return NextResponse.json({ success: true, glTxHash });

  } catch (e) {
    console.error('[heartbeat-start] Failed:', e.message);
    return err(500, `GenLayer submission failed: ${e.message}`);
  }
}

function err(status, message) {
  return NextResponse.json({ success: false, error: message }, { status });
}
