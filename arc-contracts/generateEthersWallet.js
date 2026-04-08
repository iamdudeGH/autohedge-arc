const { ethers } = require("ethers");
const fs = require("fs");

async function main() {
    const wallet = ethers.Wallet.createRandom();
    console.log("==========================================");
    console.log("Successfully created new keypair.");
    console.log("Address:", wallet.address);
    console.log("Private key:", wallet.privateKey);
    console.log("==========================================\n");

    const envPath = ".env";
    const envContent = `PRIVATE_KEY="${wallet.privateKey}"\nHELLOARCHITECT_ADDRESS=""\n`;
    fs.writeFileSync(envPath, envContent);
    console.log("Secret saved to .env file in arc-contracts directory.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
