import { createClient, createAccount } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import * as fs from 'fs';

const account = createAccount('0x9876543210987654321098765432109876543210987654321098765432109876');
const client = createClient({
  chain: studionet,
  account,
});

async function deploy() {
  console.log("🚀 Deploying updated AI_treasury_rebalancer.py to GenLayer...");
  const code = fs.readFileSync('AI_treasury_rebalancer.py', 'utf8');

  try {
    const txHash = await client.deployContract({
      code,
      args: [70, 25, 200], 
    });
    
    console.log(`⏳ Deployment TX submitted: ${txHash}`);
    console.log("   Waiting for consensus...");

    let receipt = null;
    for (let i=0; i<30; i++) {
        await new Promise(r => setTimeout(r, 4000));
        try {
            receipt = await client.getTransaction({ hash: txHash });
            const s = receipt?.statusName || String(receipt?.status);
            if (['FINALIZED', 'ACCEPTED', '3', '5'].includes(s)) {
                break;
            }
            if (['ERROR', 'REVERTED', '4'].includes(s)) {
                console.error("❌ Transaction failed execution! Status:", s);
                process.exit(1);
            }
        } catch (e) {}
    }

    // Now wait a bit and fetch user's newest contract
    console.log("Wait for indexing...");
    await new Promise(r => setTimeout(r, 5000));

    // Try reading logs from `receipt.contractAddress` if available
    let addr = receipt.contractAddress || receipt.address || receipt.to_address;
    if (!addr) {
         // fallback: just dump receipt
         console.log(JSON.stringify(receipt, null, 2));
         return;
    }

    console.log("✅ Deployed at:", addr);
    
    // Test it!
    console.log("Testing get_constitution...");
    const consti = await client.readContract({
        address: addr,
        functionName: 'get_constitution',
        args: []
    });
    console.log("Constitution:", consti);

  } catch (error) {
    console.error("❌ Deployment failed:", error);
  }
}

deploy();
