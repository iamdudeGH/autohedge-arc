// Contract addresses
export const GENLAYER_CONTRACT_ADDRESS = "0x3E42934cF056A3fA90e624aacb459C1D152DDf5A";
export const ARC_CONTRACT_ADDRESS = "0xa0935944899826b4E32aCDBe2557fF6E0a9470c1";

// Network configs
export const ARC_TESTNET = {
  chainId: "0x4cef52", // Correct Arc testnet chain ID
  chainName: "Arc Testnet",
  rpcUrls: ["https://rpc.testnet.arc.network"],
  blockExplorerUrls: ["https://testnet.arcscan.app"],
  nativeCurrency: {
    name: "Arc Token",
    symbol: "ARC", // Changed from USDC/6 to standard EVM 18 decimals for network config
    decimals: 18,
  },
};

export const ARC_EXPLORER_URL = "https://testnet.arcscan.app";
export const GENLAYER_STUDIO_URL = "https://studio.genlayer.com";
