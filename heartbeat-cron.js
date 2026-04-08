/**
 * heartbeat-cron.js — AutoHedge Autonomous Scheduler
 *
 * Calls POST /api/run-full-heartbeat on the Next.js dashboard server every
 * N minutes.  The API route handles EVERYTHING (GenLayer AI analysis + Arc
 * relay) so this script needs no private keys and no blockchain SDK.
 *
 * Usage:
 *   node heartbeat-cron.js
 *
 * Config via .env in this directory:
 *   DASHBOARD_URL       — URL of the running dashboard (default: http://localhost:3000)
 *   HEARTBEAT_INTERVAL  — Minutes between heartbeats  (default: 60)
 *
 * Run forever with pm2:
 *   npx pm2 start heartbeat-cron.js --name autohedge-cron
 *   npx pm2 save
 */

require("dotenv").config();

const DASHBOARD_URL    = (process.env.DASHBOARD_URL || "http://localhost:3000").replace(/\/$/, "");
const INTERVAL_MIN     = parseInt(process.env.HEARTBEAT_INTERVAL || "60", 10);
const INTERVAL_MS      = INTERVAL_MIN * 60 * 1000;
const ENDPOINT         = `${DASHBOARD_URL}/api/run-full-heartbeat`;

const ts  = () => new Date().toISOString();
const log = (level, msg) => console.log(`[${ts()}] [${level.padEnd(7)}] ${msg}`);

// ── Heartbeat ─────────────────────────────────────────────────────────────────
async function runHeartbeat() {
  log("INFO", `Triggering heartbeat → ${ENDPOINT}`);

  try {
    const res  = await fetch(ENDPOINT, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({}),
      signal:  AbortSignal.timeout(180_000), // 3-minute timeout (AI consensus can be slow)
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      log("ERROR", `Heartbeat failed: ${data.error ?? JSON.stringify(data)}`);
      return;
    }

    switch (data.action) {
      case "TRADE_EXECUTED":
        log("SUCCESS",
          `🔴 TRADE EXECUTED | Arc Tx: ${data.arcTxHash?.slice(0, 14)}… | ` +
          `Block: ${data.blockNumber} | Risk: ${data.riskScore} | ${data.reasoning}`
        );
        break;
      case "HEARTBEAT_SAFE":
        log("SUCCESS",
          `🟢 SAFE | Risk: ${data.riskScore} | ${data.reasoning}`
        );
        break;
      case "RELAY_FAILED":
        log("WARN",
          `⚠️  AI authorised trade but Arc relay failed: ${data.error}`
        );
        break;
      default:
        log("INFO", `Result: ${data.action ?? "unknown"} — ${JSON.stringify(data)}`);
    }

  } catch (err) {
    log("ERROR", `Request failed: ${err.message}`);
    // Don't exit — let the next interval retry
  }
}

// ── Startup ───────────────────────────────────────────────────────────────────
console.log("═══════════════════════════════════════════════");
console.log("  🤖 AutoHedge Heartbeat Cron");
console.log("═══════════════════════════════════════════════");
log("INFO", `Dashboard : ${DASHBOARD_URL}`);
log("INFO", `Endpoint  : ${ENDPOINT}`);
log("INFO", `Interval  : every ${INTERVAL_MIN} minute(s)`);
console.log("═══════════════════════════════════════════════");

// Fire immediately on startup, then on schedule
runHeartbeat();
setInterval(runHeartbeat, INTERVAL_MS);
