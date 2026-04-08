/**
 * GET /api/get-treasury?wallet=0xUserAddress
 *
 * Checks the registry (Vercel KV or local JSON) for an existing demo
 * TreasuryRebalancerDemo contract address for the given wallet.
 *
 * Response:
 *   { found: true,  contractAddress: "0x..." }
 *   { found: false }
 */

import { NextResponse } from 'next/server';
import { getTreasury }  from '@/lib/registry';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const wallet = searchParams.get('wallet');

  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    return NextResponse.json(
      { error: 'Invalid or missing wallet address' },
      { status: 400 }
    );
  }

  try {
    const contractAddress = await getTreasury(wallet);

    if (contractAddress) {
      return NextResponse.json({ found: true, contractAddress });
    } else {
      return NextResponse.json({ found: false });
    }
  } catch (e) {
    console.error('[get-treasury] Error:', e.message);
    return NextResponse.json({ error: 'Registry lookup failed' }, { status: 500 });
  }
}
