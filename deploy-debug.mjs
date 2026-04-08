import { createClient, createAccount } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import * as fs from 'fs';

let burnerKey = process.env.NEXT_PUBLIC_GL_BURNER_KEY;
if (!burnerKey) {
  const envContent = fs.readFileSync('./genrebalancer-dashboard/.env.local', 'utf8');
  burnerKey = envContent.match(/^NEXT_PUBLIC_GL_BURNER_KEY=(.*)$/m)?.[1].trim();
}

const account = createAccount(burnerKey);
const client = createClient({ chain: studionet, account });

async function run() {
  const code = fs.readFileSync('AI_treasury_rebalancer.py', 'utf8');
  console.log("Deploying...");
  const txHash = await client.deployContract({ code, args: [70, 25, 200] });
  console.log("Tx:", txHash);

  let attempts = 0;
  while (attempts < 20) {
    await new Promise(r => setTimeout(r, 4000));
    try {
      const receipt = await client.getTransaction({ hash: txHash });
      console.log(`Status (${attempts}):`, receipt?.status, receipt?.contractAddress);
      if (receipt && receipt.status !== 'PENDING') {
         if (receipt.contractAddress) {
            console.log("Deployed! Address:", receipt.contractAddress);
            return;
         }
      }
    } catch (e) {
      console.log("Poll err:", e.message);
    }
    attempts++;
  }
}
run();
