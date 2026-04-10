"use client";

import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import {
  GENLAYER_CONTRACT_ADDRESS,
  ARC_EXPLORER_URL,
  GENLAYER_STUDIO_URL,
  ARC_TESTNET,
} from './config';

// Read-only GenLayer client (no wallet needed for reads)
const glReadClient = createClient({ chain: studionet });

const DEMO_TREASURY_ABI = [
  'function getInfo() view returns (address _owner, address _relayer, uint256 _weth, uint256 _usdc, uint256 _rebalances)',
  'event RebalanceExecuted(address indexed userWallet, uint256 percentBps, uint256 amountSimulated, string signal)',
];

// ── Signal color map ──────────────────────────────────────────────────────────
const SIGNAL_COLORS = {
  SAFE:     { text: '#10b981', bg: 'rgba(16, 185, 129, 0.12)', border: 'rgba(16, 185, 129, 0.4)' },
  CAUTION:  { text: '#f59e0b', bg: 'rgba(245, 158, 11, 0.12)', border: 'rgba(245, 158, 11, 0.4)' },
  CRITICAL: { text: '#ef4444', bg: 'rgba(239, 68, 68, 0.12)',  border: 'rgba(239, 68, 68, 0.4)'  },
};

const fmt = (wei) => {
  if (!wei) return '0';
  const n = Number(ethers.formatEther(wei.toString()));
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(2);
};

// ── Main Component ─────────────────────────────────────────────────────────────
export default function Home() {
  // Wallet state
  const [walletAddress,   setWalletAddress]   = useState(null);
  const [walletShort,     setWalletShort]      = useState('');
  const [isConnecting,    setIsConnecting]     = useState(false);

  // Treasury state
  const [treasuryAddress, setTreasuryAddress]  = useState(null);
  const [treasuryInfo,    setTreasuryInfo]      = useState(null); // { weth, usdc, rebalances }
  const [isDeploying,     setIsDeploying]       = useState(false);
  const [deployError,     setDeployError]       = useState('');

  // Heartbeat state
  const [isRunning,       setIsRunning]         = useState(false);
  const [heartbeatStep,   setHeartbeatStep]     = useState('');
  const [lastResult,      setLastResult]        = useState(null);
  const [history,         setHistory]           = useState([]);

  // Global stats (from GenLayer)
  const [globalConstitution, setGlobalConstitution] = useState(null);

  // ── Auto-reconnect on page load ──────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined' || !window.ethereum) return;
    window.ethereum.request({ method: 'eth_accounts' }).then(async (accounts) => {
      if (accounts.length > 0) {
        const addr = accounts[0];
        setWalletAddress(addr);
        setWalletShort(`${addr.slice(0, 6)}…${addr.slice(-4)}`);
        await loadTreasuryForWallet(addr);
      }
    });
  }, []);

  // ── Load history from localStorage when treasury is known ───────────────────
  useEffect(() => {
    if (!walletAddress) return;
    try {
      const saved = JSON.parse(localStorage.getItem(`autohedge:history:${walletAddress}`) || '[]');
      setHistory(saved);
    } catch { setHistory([]); }
  }, [walletAddress]);

  // ── Fetch live GenLayer constitution ─────────────────────────────────────────
  useEffect(() => {
    async function fetchConstitution() {
      try {
        const raw    = await glReadClient.readContract({ address: GENLAYER_CONTRACT_ADDRESS, functionName: 'get_constitution', args: [] });
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        setGlobalConstitution(parsed);
      } catch { /* silent */ }
    }
    fetchConstitution();
  }, []);

  // ── Load treasury info from Arc ───────────────────────────────────────────────
  const fetchTreasuryInfo = useCallback(async (contractAddr) => {
    if (!contractAddr) return;
    try {
      const provider = new ethers.JsonRpcProvider('https://rpc.testnet.arc.network');
      
      const ERC20_ABI = ['function balanceOf(address account) view returns (uint256)'];
      const wethContract = new ethers.Contract('0xa48d06a3E9df191B84dbb4402c63E9E439e9e828', ERC20_ABI, provider);
      const usdcContract = new ethers.Contract('0xe1283D7724C82593013a8CFd40141789E294874E', ERC20_ABI, provider);

      const wethBal = await wethContract.balanceOf(contractAddr);
      const usdcBal = await usdcContract.balanceOf(contractAddr);

      // Rebalances count is tracked via local history in the UI now since reading events off-chain repeatedly is slow.
      setTreasuryInfo({ 
        weth: wethBal.toString(), 
        usdc: usdcBal.toString(),
        rebalancesCount: 0 // handled in JSX via history.length
      });
    } catch (e) {
      console.warn('fetchTreasuryInfo failed:', e.message);
    }
  }, []);

  useEffect(() => {
    fetchTreasuryInfo(treasuryAddress);
  }, [treasuryAddress, fetchTreasuryInfo]);

  // ── Load existing treasury for wallet ────────────────────────────────────────
  const loadTreasuryForWallet = async (wallet) => {
    try {
      const res  = await fetch(`/api/get-treasury?wallet=${wallet}`);
      const data = await res.json();
      if (data.found) {
        setTreasuryAddress(data.contractAddress);
      }
    } catch { /* silent */ }
  };

  // ── Wallet connection ─────────────────────────────────────────────────────────
  const connectWallet = async () => {
    if (!window.ethereum) {
      alert('Please install MetaMask to use the GenRebalancer demo.');
      return;
    }
    setIsConnecting(true);
    try {
      // Switch to / add Arc Testnet
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: ARC_TESTNET.chainId }],
        });
      } catch (switchErr) {
        if (switchErr.code === 4902) {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [ARC_TESTNET],
          });
        }
      }
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const addr = accounts[0];
      setWalletAddress(addr);
      setWalletShort(`${addr.slice(0, 6)}…${addr.slice(-4)}`);
      await loadTreasuryForWallet(addr);
    } catch (e) {
      console.error('Connect wallet failed:', e.message);
    } finally {
      setIsConnecting(false);
    }
  };

  // ── Deploy demo treasury ──────────────────────────────────────────────────────
  const deployTreasury = async () => {
    setIsDeploying(true);
    setDeployError('');
    try {
      const res  = await fetch('/api/deploy-treasury', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress }),
      });
      const data = await res.json();
      if (data.success) {
        setTreasuryAddress(data.contractAddress);
        await fetchTreasuryInfo(data.contractAddress);
      } else {
        setDeployError(data.error ?? 'Deployment failed. Please try again.');
      }
    } catch (e) {
      setDeployError(e.message);
    } finally {
      setIsDeploying(false);
    }
  };

  // ── Run AI heartbeat ──────────────────────────────────────────────────────────
  const runHeartbeat = async () => {
    if (!treasuryAddress) return;
    setIsRunning(true);
    setLastResult(null);
    setHeartbeatStep('1/3 — Submitting to GenLayer AI consensus…');

    try {
      // ── Step 1: Submit the GenLayer tx (fast, ~3s) ──────────────────────
      const startRes = await fetch('/api/heartbeat-start', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ treasuryAddress, userWallet: walletAddress }),
      });

      let startData;
      try {
        startData = await startRes.json();
      } catch {
        throw new Error(`Server error (HTTP ${startRes.status}). Check Vercel logs.`);
      }

      if (!startData.success) throw new Error(startData.error ?? 'GenLayer submission failed');

      const { glTxHash } = startData;
      setHeartbeatStep(`2/3 — Waiting for AI validator consensus… (TX: ${glTxHash.slice(0, 10)}…)`);

      // ── Step 2: Poll heartbeat-check every 3s until decided ──────────────
      let result = null;
      let attempts = 0;
      const maxAttempts = 40; // 40 × 3s = 2 minute max wait

      while (!result && attempts < maxAttempts) {
        await new Promise(r => setTimeout(r, 3000));
        attempts++;

        const checkRes = await fetch('/api/heartbeat-check', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ glTxHash, treasuryAddress }),
        });

        let checkData;
        try {
          checkData = await checkRes.json();
        } catch {
          // Non-JSON response — skip this poll and try again
          continue;
        }

        if (checkData.decided) {
          result = checkData;
          break;
        }

        // Surface server-side errors immediately instead of silently timing out
        if (checkData.success === false && checkData.error) {
          throw new Error(`Heartbeat check failed: ${checkData.error}`);
        }

        // Still pending — update the step counter
        setHeartbeatStep(`2/3 — AI validators reaching consensus… (${attempts * 3}s elapsed)`);
      }

      if (!result) throw new Error('Consensus timed out after 2 minutes. Please try again.');

      // ── Step 3: Show result ──────────────────────────────────────────────
      setHeartbeatStep('3/3 — Arc transaction confirmed!');
      if (!result.success) throw new Error(result.error ?? 'Heartbeat failed');

      setLastResult(result);

      // Refresh treasury balances
      await fetchTreasuryInfo(treasuryAddress);

      // Save to localStorage history
      const entry   = { ...result, timestamp: Date.now() };
      const saved   = JSON.parse(localStorage.getItem(`autohedge:history:${walletAddress}`) || '[]');
      const updated = [entry, ...saved].slice(0, 20);
      localStorage.setItem(`autohedge:history:${walletAddress}`, JSON.stringify(updated));
      setHistory(updated);

    } catch (e) {
      setLastResult({ success: false, error: e.message });
      setHeartbeatStep('');
    } finally {
      setIsRunning(false);
    }
  };

  // ── Risk score bar width ──────────────────────────────────────────────────────
  const getRiskBar = (score) => {
    const pct = Math.round((score ?? 0) * 100);
    const color = pct >= 75 ? '#ef4444' : pct >= 50 ? '#f59e0b' : '#10b981';
    return { pct, color };
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  // STATE 1 — Not connected
  if (!walletAddress) {
    return (
      <main className="dashboard-container">
        {/* Header */}
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4rem', paddingBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div>
            <h1 className="gradient-text" style={{ fontSize: '2.5rem', margin: 0 }}>
              GenRebalancer <span style={{ fontWeight: 300 }}>× Arc</span>
            </h1>
            <p style={{ color: 'var(--text-muted)', margin: '0.25rem 0 0', fontSize: '0.85rem' }}>
              Cross-chain AI Treasury Manager
            </p>
          </div>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block', boxShadow: '0 0 6px var(--accent-glow)' }} />
              GenLayer Studionet
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', display: 'inline-block', boxShadow: '0 0 6px #10b981' }} />
              Arc Testnet
            </div>
          </div>
        </header>

        {/* Hero */}
        <div style={{ textAlign: 'center', padding: '2rem 0 4rem' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.5rem' }}>
            <img 
              src="/logo.png" 
              alt="GenRebalancer Shield" 
              style={{ width: 160, height: 160, borderRadius: '32px', filter: 'drop-shadow(0 0 40px rgba(139, 92, 246, 0.4))', border: '1px solid rgba(255,255,255,0.1)' }} 
            />
          </div>
          <h2 style={{ fontSize: '3rem', fontWeight: 800, margin: '0 0 1rem', background: 'linear-gradient(135deg, #fff 30%, #93c5fd)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Your Personal AI Treasury
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '1.2rem', maxWidth: 560, margin: '0 auto 2.5rem', lineHeight: 1.7 }}>
            Connect your wallet to deploy your own demo treasury on Arc Network.
            Watch the GenLayer AI analyze live market data and trigger a real
            on-chain transaction — with your wallet address in the event log.
          </p>
          <button
            className="btn-connect"
            onClick={connectWallet}
            disabled={isConnecting}
            style={{ fontSize: '1.1rem', padding: '1rem 2.5rem', borderRadius: '50px', border: 'none' }}
          >
            {isConnecting ? '⏳ Connecting…' : '🦊 Connect Wallet to Start'}
          </button>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '1rem' }}>
            Connects to Arc Testnet. No real funds required.
          </p>
        </div>

        {/* How it works cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.5rem', marginTop: '2rem' }}>
          {[
            { icon: '🔗', title: 'Connect Wallet', desc: 'Your MetaMask connects to Arc Testnet. We deploy a personal treasury contract owned by your address.' },
            { icon: '🧠', title: 'AI Analysis', desc: 'GenLayer queries 3 live oracles: Fear & Greed Index, CoinGecko, and Coinpaprika. AI reaches consensus across validators.' },
            { icon: '⚡', title: 'Live Arc Tx', desc: 'Every heartbeat produces a real Arc transaction — viewable on ArcScan with your wallet address in the event.' },
          ].map(({ icon, title, desc }) => (
            <div key={title} className="glass-panel" style={{ textAlign: 'center', padding: '2rem 1.5rem' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>{icon}</div>
              <h3 style={{ margin: '0 0 0.75rem', color: '#fff', fontSize: '1.1rem' }}>{title}</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0, lineHeight: 1.6 }}>{desc}</p>
            </div>
          ))}
        </div>

        {/* Powered by */}
        <div style={{ textAlign: 'center', marginTop: '4rem', color: 'var(--text-muted)', fontSize: '0.8rem', display: 'flex', gap: '1.5rem', justifyContent: 'center', alignItems: 'center' }}>
          <span>Powered by</span>
          <a href="https://genlayer.com" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>GenLayer</a>
          <span>×</span>
          <a href="https://arc.network" target="_blank" rel="noreferrer" style={{ color: '#10b981', textDecoration: 'none', fontWeight: 600 }}>Arc Network</a>
        </div>
      </main>
    );
  }

  // STATE 2 — Connected, no treasury yet
  if (!treasuryAddress) {
    return (
      <main className="dashboard-container">
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3rem', paddingBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <h1 className="gradient-text" style={{ fontSize: '1.8rem', margin: 0 }}>
            GenRebalancer × Arc
          </h1>
          <div className="glass-panel" style={{ padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', display: 'inline-block', boxShadow: '0 0 6px #10b981' }} />
            <span style={{ fontFamily: 'monospace', fontSize: '0.9rem', color: 'var(--text-muted)' }}>{walletShort}</span>
            <span style={{ fontSize: '0.75rem', color: '#10b981', fontWeight: 600 }}>Arc Testnet</span>
          </div>
        </header>

        <div style={{ maxWidth: 580, margin: '2rem auto', textAlign: 'center' }}>
          <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>🏦</div>
          <h2 style={{ fontSize: '2rem', fontWeight: 700, margin: '0 0 1rem', color: '#fff' }}>
            Initialize Your Demo Treasury
          </h2>
          <p style={{ color: 'var(--text-muted)', lineHeight: 1.7, marginBottom: '2rem' }}>
            We'll deploy a <strong style={{ color: '#fff' }}>TreasuryRebalancerDemo</strong> contract
            on Arc Testnet — owned by your wallet, seeded with 1,000 simulated WETH.
            The backend pays the gas. You pay nothing.
          </p>

          {/* Steps */}
          <div style={{ textAlign: 'left', marginBottom: '2.5rem' }}>
            {[
              ['1', 'Deploy your personal contract on Arc Testnet (your wallet = owner)'],
              ['2', 'Trigger the AI heartbeat — GenLayer queries 3 live market oracles'],
              ['3', 'See YOUR Arc transaction on ArcScan with your wallet in the event log'],
            ].map(([num, text]) => (
              <div key={num} style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', marginBottom: '1rem' }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.85rem', flexShrink: 0 }}>
                  {num}
                </div>
                <p style={{ margin: 0, color: 'var(--text-muted)', lineHeight: 1.5, paddingTop: 4 }}>{text}</p>
              </div>
            ))}
          </div>

          <button
            className="btn-trigger"
            onClick={deployTreasury}
            disabled={isDeploying}
            style={{ fontSize: '1.1rem', padding: '1rem 2.5rem', textTransform: 'none', letterSpacing: '0.5px' }}
          >
            {isDeploying ? '⏳ Deploying on Arc…' : '🚀 Initialize My Demo Treasury'}
          </button>

          {deployError && (
            <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 12, color: '#fca5a5', fontSize: '0.9rem' }}>
              ⚠️ {deployError}
            </div>
          )}

          {isDeploying && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '1rem' }}>
              Deploying contract on Arc Testnet… This takes ~10-20 seconds.
            </p>
          )}
        </div>
      </main>
    );
  }

  // STATE 3 — Treasury active — main dashboard
  const colors = SIGNAL_COLORS[lastResult?.marketSignal] ?? SIGNAL_COLORS.SAFE;
  const { pct: riskPct, color: riskColor } = getRiskBar(lastResult?.riskScore);
  const isTradeExecuted = lastResult?.action === 'TRADE_EXECUTED';

  return (
    <main className="dashboard-container">
      {/* Header */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', paddingBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.08)', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="gradient-text" style={{ fontSize: '1.8rem', margin: 0 }}>
            GenRebalancer × Arc
          </h1>
          <p style={{ color: 'var(--text-muted)', margin: '0.2rem 0 0', fontSize: '0.8rem' }}>Cross-chain AI Treasury Manager</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="glass-panel" style={{ padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', display: 'inline-block', boxShadow: '0 0 6px #10b981' }} />
            <span style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: 'var(--text-muted)' }}>{walletShort}</span>
            <span style={{ fontSize: '0.7rem', color: '#10b981', fontWeight: 600 }}>Arc Testnet</span>
          </div>
        </div>
      </header>

      {/* My Treasury Card */}
      <div className="glass-panel" style={{ marginBottom: '1.5rem', background: 'linear-gradient(135deg, rgba(59,130,246,0.08), rgba(16,185,129,0.05))' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>My Treasury Contract (Arc Testnet)</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.5rem' }}>
              <span style={{ fontFamily: 'monospace', fontSize: '1rem', color: '#fff' }}>
                {treasuryAddress.slice(0, 10)}…{treasuryAddress.slice(-8)}
              </span>
              <a href={`${ARC_EXPLORER_URL}/address/${treasuryAddress}`} target="_blank" rel="noreferrer"
                style={{ color: 'var(--accent)', fontSize: '0.8rem', textDecoration: 'none', padding: '0.2rem 0.6rem', border: '1px solid rgba(59,130,246,0.4)', borderRadius: 6 }}>
                View on ArcScan ↗
              </a>
            </div>
          </div>
          {treasuryInfo && (
            <div style={{ display: 'flex', gap: '2rem' }}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Demo WETH</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#93c5fd', fontFamily: 'monospace' }}>
                  {fmt(treasuryInfo.weth)}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Demo USDC</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#10b981', fontFamily: 'monospace' }}>
                  {fmt(treasuryInfo.usdc)}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Heartbeats</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--accent)', fontFamily: 'monospace' }}>
                  {history.length}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Contract addresses reference row */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
        <div className="glass-panel" style={{ flex: 1, minWidth: 240, padding: '0.75rem 1rem' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', display: 'block' }}>GenLayer Contract</span>
          <a href={`${GENLAYER_STUDIO_URL}/contracts/${GENLAYER_CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer"
            style={{ color: 'var(--accent)', textDecoration: 'none', fontFamily: 'monospace', fontSize: '0.82rem' }}>
            {GENLAYER_CONTRACT_ADDRESS.slice(0, 10)}…{GENLAYER_CONTRACT_ADDRESS.slice(-8)} ↗
          </a>
        </div>
        {globalConstitution && (
          <div className="glass-panel" style={{ flex: 1, minWidth: 240, padding: '0.75rem 1rem' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', display: 'block' }}>AI Risk Tolerance</span>
            <span style={{ color: '#fff', fontFamily: 'monospace', fontSize: '0.85rem', fontWeight: 600 }}>
              {globalConstitution.risk_tolerance_pct}% threshold · {globalConstitution.speed_limit}% max sell
            </span>
          </div>
        )}
      </div>

      {/* ── Heartbeat section ── */}
      <div className="trigger-section" style={{ margin: '2.5rem 0' }}>
        <button
          className="btn-trigger"
          onClick={runHeartbeat}
          disabled={isRunning}
          style={{ fontSize: '1.3rem' }}
        >
          {isRunning ? '⏳ AI Analyzing…' : '⚡ Run AI Heartbeat'}
        </button>
        {isRunning && (
          <p style={{ marginTop: '1rem', color: 'var(--accent)', fontWeight: 600, fontSize: '0.9rem' }}>
            {heartbeatStep}
          </p>
        )}
        {!isRunning && !lastResult && (
          <p style={{ marginTop: '1rem', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            Triggers live AI analysis on 3 market oracles via GenLayer. Results appear as a real Arc transaction.
          </p>
        )}
      </div>

      {/* ── Latest result card ── */}
      {lastResult && (
        <div className="glass-panel" style={{
          marginBottom: '2rem',
          border: `1px solid ${lastResult.success ? colors.border : 'rgba(239,68,68,0.4)'}`,
          background: lastResult.success ? colors.bg : 'rgba(239,68,68,0.08)',
        }}>
          {lastResult.success ? (
            <>
              {/* Signal badge + risk bar */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <span style={{ fontSize: '1.5rem' }}>
                    {lastResult.marketSignal === 'SAFE' ? '🟢' : lastResult.marketSignal === 'CAUTION' ? '🟡' : '🔴'}
                  </span>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: '1.3rem', color: colors.text }}>
                      {lastResult.marketSignal}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {isTradeExecuted ? 'Trade Executed' : 'Safe Heartbeat'}
                    </div>
                  </div>
                </div>
                {lastResult.arcTxHash && (
                  <a
                    href={lastResult.explorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                      background: isTradeExecuted ? 'rgba(239,68,68,0.2)' : 'rgba(16,185,129,0.15)',
                      border: `1px solid ${isTradeExecuted ? 'rgba(239,68,68,0.5)' : 'rgba(16,185,129,0.4)'}`,
                      color: isTradeExecuted ? '#fca5a5' : '#6ee7b7',
                      textDecoration: 'none', padding: '0.6rem 1.2rem',
                      borderRadius: 50, fontWeight: 700, fontSize: '0.9rem',
                      boxShadow: isTradeExecuted ? '0 0 15px rgba(239,68,68,0.2)' : '0 0 15px rgba(16,185,129,0.15)',
                    }}
                  >
                    ⛓ View on ArcScan ↗
                  </a>
                )}
              </div>

              {/* Risk bar */}
              <div style={{ marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>AI Risk Score</span>
                  <span style={{ fontSize: '0.78rem', color: riskColor, fontWeight: 700 }}>{(lastResult.riskScore ?? 0).toFixed(3)}</span>
                </div>
                <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${riskPct}%`, background: `linear-gradient(90deg, ${riskColor}80, ${riskColor})`, borderRadius: 4, transition: 'width 0.8s ease' }} />
                </div>
              </div>

              {/* Reasoning */}
              <p style={{ margin: '0 0 1rem', color: 'var(--text-main)', fontSize: '0.95rem', lineHeight: 1.6 }}>
                {lastResult.reasoning}
              </p>

              {/* Meta */}
              <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.8rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                {isTradeExecuted && (
                  <span>Rebalanced <strong style={{ color: '#fca5a5' }}>{(lastResult.percentBps / 100).toFixed(0)}%</strong> of portfolio</span>
                )}
                {lastResult.glTxHash && (
                  <span>
                    GenLayer tx:{' '}
                    <a href={`${GENLAYER_STUDIO_URL}/transactions/${lastResult.glTxHash}`} target="_blank" rel="noreferrer" style={{ color: '#8b5cf6', textDecoration: 'none', fontFamily: 'monospace' }}>
                      {lastResult.glTxHash?.slice(0, 10)}…
                    </a>
                  </span>
                )}
                {lastResult.arcTxHash && (
                  <span>
                    Arc tx:{' '}
                    <a href={lastResult.explorerUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none', fontFamily: 'monospace' }}>
                      {lastResult.arcTxHash?.slice(0, 10)}…
                    </a>
                  </span>
                )}
              </div>
            </>
          ) : (
            <p style={{ color: '#fca5a5', margin: 0 }}>⚠️ {lastResult.error}</p>
          )}
        </div>
      )}

      {/* ── History ── */}
      {history.length > 0 && (
        <div className="glass-panel" style={{ marginBottom: '2rem' }}>
          <h2 style={{ borderColor: 'rgba(255,255,255,0.06)' }}>📋 My Heartbeat History</h2>
          <ul className="log-list">
            {history.map((h, i) => {
              const hColors = SIGNAL_COLORS[h.marketSignal] ?? SIGNAL_COLORS.SAFE;
              const hTrade  = h.action === 'TRADE_EXECUTED';
              return (
                <li key={i} className={`log-item ${hTrade ? 'TRADE_AUTHORIZED' : 'HEARTBEAT_SAFE'}`}>
                  <div className="log-header">
                    <span style={{ color: hTrade ? '#fca5a5' : '#86efac' }}>
                      {hTrade ? '🔴 TRADE EXECUTED' : '🟢 HEARTBEAT SAFE'}
                      {h.marketSignal && <span style={{ color: hColors.text, marginLeft: '0.75rem', fontWeight: 400, fontSize: '0.9rem' }}>{h.marketSignal}</span>}
                    </span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {new Date(h.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <p style={{ margin: '0.5rem 0', fontSize: '0.9rem', color: 'var(--text-main)' }}>{h.reasoning}</p>
                  <div style={{ display: 'flex', gap: '1rem', fontSize: '0.8rem', color: 'var(--text-muted)', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span>Risk: <strong style={{ color: 'var(--accent)' }}>{(h.riskScore ?? 0).toFixed(3)}</strong></span>
                    
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: '1.5rem' }}>
                      {h.glTxHash && (
                        <a href={`${GENLAYER_STUDIO_URL}/transactions/${h.glTxHash}`} target="_blank" rel="noreferrer"
                           style={{ color: '#8b5cf6', textDecoration: 'none' }}>
                          View GenLayer tx ↗
                        </a>
                      )}
                      {h.arcTxHash && (
                        <a href={h.explorerUrl} target="_blank" rel="noreferrer"
                           style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                          View Arc tx ↗
                        </a>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </main>
  );
}
