import { createClient, createAccount } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { DECIDED_STATES } from 'genlayer-js/types';

// Read args
const args = process.argv.slice(2);
const txHash = args[0];

if (!txHash) {
  console.log("Usage: node check-gl-tx.mjs <txHash>");
  process.exit(1);
}

const glReadClient = createClient({ chain: studionet });

async function checkTx() {
  try {
    console.log(`Checking status for TX: ${txHash}`);
    const receipt = await glReadClient.getTransaction({ hash: txHash });
    console.log("Full receipt:", JSON.stringify(receipt, null, 2));
    if (receipt) {
        console.log("Status:", receipt.status);
        console.log("Is decided?", DECIDED_STATES.includes(receipt.status));
    } else {
        console.log("Receipt not found. Still pending or invalid hash?");
    }
  } catch (err) {
    console.error("Error checking tx:", err.message);
  }
}

checkTx();
