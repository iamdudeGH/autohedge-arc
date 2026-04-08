# GenRebalancer × Arc 🛡️

**GenRebalancer** is an autonomous, cross-chain AI Treasury Manager built at the intersection of **GenLayer** and the **Arc Network**. It protects DAO treasuries and user portfolios by monitoring global cryptocurrency market conditions via AI consensus and executing protective on-chain trades.

---

## ⚡ Features

- **Multi-Oracle AI Consensus:** GenLayer Intelligent Contracts query live market data from multiple sources (Fear & Greed Index, CoinGecko, Coinpaprika) and use Large Language Models (LLMs) to natively analyze the macro environment.
- **Deterministic Execution:** The AI's subjective analysis is distilled into a deterministic `risk_score`. GenLayer's Equivalence Principle forces validators to reach consensus on the final output, ensuring mathematical integrity.
- **Cross-Chain Relay:** When market conditions trigger a `CAUTION` or `CRITICAL` signal, a Node.js relayer seamlessly executes the corresponding swap transaction directly on the EVM-compatible Arc Testnet.
- **Scaled Hedging (DCA-out):** Treasury algorithms execute fractional hedging (e.g., selling 25% of *remaining* volatile assets) to safely "Dollar-Cost Average" out of crashing markets without panic-selling the bottom.

---

## 🏗️ Architecture

The application is split into three main components:

1. **Intelligent Contract (`AI_treasury_rebalancer.py`)**  
   Deployed on GenLayer. Contains the LLM prompting logic, Oracle API calls, and validator consensus logic. Emits the final `risk_score` and `market_signal`.
2. **Arc Smart Contracts (`arc-contracts/`)**  
   Standard Solidity smart contracts (built with Hardhat) deployed on the Arc Testnet. The `TreasuryRebalancer.sol` contract holds user funds (MockWETH) and natively integrates with Uniswap V3-compatible DEX routers to perform protective swaps into USDC.
3. **Next.js Dashboard (`genrebalancer-dashboard/`)**  
   The frontend UI. Allows users to connect their MetaMask wallets, instantly deploy a personal Demo Treasury to the Arc testnet (seeded with 1,000 native MockWETH tokens), and trigger the "AI Heartbeat" to visualize the execution flow in real-time.

---

## 🚀 How to Run the Demo

### Prerequisites
- Node.js v18+
- MetaMask Wallet configured for **Arc Testnet** (`Chain ID: 4243`)

### 1. Start the Frontend
Navigate to the dashboard directory and install dependencies:
```bash
cd genrebalancer-dashboard
npm install
npm run dev
```

### 2. Connect & Deploy
Open `http://localhost:3000` in your browser. Connect MetaMask and click **"Initialize My Demo Treasury"**. This will instantly deploy your personal `TreasuryRebalancer` to the Arc network and fund it with 1,000 WETH.

### 3. Run the Heartbeat
Click **Trigger Heartbeat**. 
1. The app fires an AI query to the GenLayer Testnet.
2. The AI reads the market and calculates a risk score.
3. The result securely cascades down to your Arc smart contract, swapping WETH for USDC on the underlying DEX if the market is deemed critical. 

You can view the verifiable ERC-20 token transfers and events natively on [ArcScan](https://testnet.arcscan.app/).

---

## 📜 License
MIT License.
