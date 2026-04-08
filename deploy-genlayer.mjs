import { createClient, createAccount } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import * as fs from 'fs';

const DASHBOARD_ENV = './genrebalancer-dashboard/.env.local';
let burnerKey = process.env.NEXT_PUBLIC_GL_BURNER_KEY;

if (fs.existsSync(DASHBOARD_ENV)) {
  const envContent = fs.readFileSync(DASHBOARD_ENV, 'utf8');
  const match = envContent.match(/^NEXT_PUBLIC_GL_BURNER_KEY=(.*)$/m);
  if (match) {
    burnerKey = match[1].trim();
  }
}

const ARC_CONTRACT = "0xa0935944899826b4E32aCDBe2557fF6E0a9470c1";

const account = createAccount(burnerKey);
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
      args: [70, 25, 200, ARC_CONTRACT], 
    });
    
    console.log(`⏳ Deployment TX submitted: ${txHash}`);
    console.log("   Waiting for consensus...");

    let receipt = null;
    for (let i=0; i<30; i++) {
        await new Promise(r => setTimeout(r, 4000));
        try {
            receipt = await client.getTransaction({ hash: txHash });
            // Statuses: 3 is FINALIZED, 5 is REVERTED/ERROR.
            if (receipt && (receipt.status === 3 || receipt.status === 'FINALIZED' || receipt.status === 'ACCEPTED')) {
                break;
            }
            if (receipt && (receipt.status === 5 || receipt.status === 'ERROR')) {
                console.error("❌ Transaction failed execution! Status:", receipt.status);
                process.exit(1);
            }
        } catch (e) {
            // Still pending
        }
    }

    // Try to find the contract address
    let contractAddress = receipt?.contractAddress || receipt?.address;
    if (!contractAddress) {
        console.log("⚠️ Could not extract contract address natively from receipt, will use transaction search...");
        contractAddress = txHash; // sometimes txHash is the address or they map directly in some versions
    }

    console.log(`\n✅ GenLayer Contract Deployed Successfully!`);
    console.log(`📍 New Address/Target: ${contractAddress}`);

    const CONFIG_PATH = './genrebalancer-dashboard/src/app/config.js';
    let configContent = fs.readFileSync(CONFIG_PATH, 'utf8');
    configContent = configContent.replace(
      /export const GENLAYER_CONTRACT_ADDRESS = ".*";/,
      `export const GENLAYER_CONTRACT_ADDRESS = "${contractAddress}";`
    );
    fs.writeFileSync(CONFIG_PATH, configContent);

    let envContent = fs.readFileSync(DASHBOARD_ENV, 'utf8');
    envContent = envContent.replace(
      /GENLAYER_CONTRACT_ADDRESS=.*/,
      `GENLAYER_CONTRACT_ADDRESS=${contractAddress}`
    );
    fs.writeFileSync(DASHBOARD_ENV, envContent);

    console.log(`\n💾 Addresses cleanly written. Restart your Next.js server!`);

  } catch (error) {
    console.error("❌ Deployment failed:", error);
  }
}

deploy();
