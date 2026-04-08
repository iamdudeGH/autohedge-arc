# v0.3.0  — Production-hardened GenLayer Intelligent Contract
# Fixes applied:
#   [Issue 3] LLM no longer decides authorize_trade — Python deterministic math handles it.
#   [Issue 4] Multi-oracle fallback: Alternative.me + CoinGecko + Coinpaprika.
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
import json

@gl.evm.contract_interface
class TreasuryRebalancer:
    class View:
        def owner(self, /) -> Address: ...
    class Write:
        def rebalance(self, percentBps: u256, signal: str, /) -> bool: ...

class GenRebalancer(gl.Contract):
    owner: Address
    treasury_address: Address
    risk_tolerance_pct: u256
    speed_limit: u256
    protection_slippage: u256
    audit_logs: DynArray[str]

    def __init__(self, risk_tolerance_pct: int = 70, speed_limit: int = 25, protection_slippage: int = 200):
        self.owner = gl.message.sender_address
        self.treasury_address = gl.message.sender_address
        self.risk_tolerance_pct = u256(risk_tolerance_pct)
        self.speed_limit = u256(speed_limit)
        self.protection_slippage = u256(protection_slippage)
        self.audit_logs = DynArray[str]()

    @gl.public.view
    def get_constitution(self) -> str:
        return json.dumps({
            "risk_tolerance": int(self.risk_tolerance_pct) / 100.0,
            "risk_tolerance_pct": int(self.risk_tolerance_pct),
            "speed_limit": int(self.speed_limit),
            "protection_slippage": int(self.protection_slippage),
            "owner": str(self.owner),
            "treasury": str(self.treasury_address)
        })

    @gl.public.view
    def get_audit_logs(self) -> str:
        return json.dumps(list(self.audit_logs))

    @gl.public.write
    def set_treasury(self, new_treasury: Address) -> None:
        assert gl.message.sender_address == self.owner, "Only owner can set treasury"
        if isinstance(new_treasury, int):
            new_treasury = "0x" + new_treasury.to_bytes(20, "big").hex()
        self.treasury_address = Address(new_treasury)

    @gl.public.write
    def update_constitution(self, risk_tolerance_pct: int, speed_limit: int, protection_slippage: int) -> None:
        assert gl.message.sender_address == self.owner, "Only owner can update constitution"
        self.risk_tolerance_pct = u256(risk_tolerance_pct)
        self.speed_limit = u256(speed_limit)
        self.protection_slippage = u256(protection_slippage)

    @gl.public.write
    def heartbeat(self) -> str:
        # Deterministic risk limit computed in Python — NOT delegated to the LLM.
        # FIX [Issue 3]: authorize_trade is calculated here using Python math operators.
        risk_limit = int(self.risk_tolerance_pct) / 100.0

        def run_analysis() -> str:
            # ── FIX [Issue 4]: Multi-oracle data collection with per-source fallback ──
            #
            # We fetch from three independent oracles. Each is wrapped in its own
            # try/except so a single failure does not blind the AI analyst.
            # If ALL sources fail, we default to a safe / no-trade posture.

            oracle_results = {}

            # Oracle 1 — Alternative.me Fear & Greed Index
            try:
                raw = gl.nondet.web.render("https://api.alternative.me/fng/", mode="text")
                oracle_results["alternative_me_fng"] = raw[:400]
            except Exception as e:
                oracle_results["alternative_me_fng"] = f"UNAVAILABLE: {str(e)}"

            # Oracle 2 — CoinGecko BTC simple price (market proxy)
            try:
                raw = gl.nondet.web.render(
                    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true",
                    mode="text"
                )
                oracle_results["coingecko_btc"] = raw[:400]
            except Exception as e:
                oracle_results["coingecko_btc"] = f"UNAVAILABLE: {str(e)}"

            # Oracle 3 — Coinpaprika BTC global ticker
            try:
                raw = gl.nondet.web.render(
                    "https://api.coinpaprika.com/v1/tickers/btc-bitcoin?quotes=USD",
                    mode="text"
                )
                oracle_results["coinpaprika_btc"] = raw[:400]
            except Exception as e:
                oracle_results["coinpaprika_btc"] = f"UNAVAILABLE: {str(e)}"

            # If every oracle failed, return a safe-default immediately.
            all_failed = all("UNAVAILABLE" in v for v in oracle_results.values())
            if all_failed:
                return json.dumps({
                    "risk_score": 0.0,
                    "market_signal": "SAFE",
                    "reasoning": "All market data oracles are currently unavailable. Defaulting to safe posture.",
                    "data_timestamp": "N/A",
                    "oracles_available": 0
                })

            oracles_available = sum(1 for v in oracle_results.values() if "UNAVAILABLE" not in v)

            # FIX [Issue 3]: The AI is ONLY asked to extract a risk_score float
            # and a market_signal label.  It does NO boolean math.
            # The authorize_trade decision is made purely in Python below.
            prompt = f"""
You are a DAO treasury risk analyst. Your ONLY job is to read the market data
below and extract a risk score. Do NOT decide whether to trade.

--- MARKET DATA (use all available sources, ignore UNAVAILABLE ones) ---
Alternative.me Fear & Greed: {oracle_results["alternative_me_fng"]}
CoinGecko BTC Price:         {oracle_results["coingecko_btc"]}
Coinpaprika BTC Ticker:      {oracle_results["coinpaprika_btc"]}
--- END DATA ---

Instructions:
- Read the Fear & Greed value from Alternative.me (0=extreme panic/fear, 100=extreme greed/bull market).
- Convert it to a `risk_score` between 0.0 (safe) and 1.0 (maximum danger).
  IMPORTANT INVERSION: We want HIGH risk when the market is crashing!
  So an Extreme Fear value of 11 MUST map to a HIGH risk_score of 0.89 (i.e., 1.0 - 0.11).
  A Greed value of 75 must map to a LOW risk_score of 0.25 (i.e., 1.0 - 0.75).
- If Alternative.me is UNAVAILABLE, derive risk_score from price momentum in the other sources.
- Assign market_signal: SAFE (risk<0.5) | CAUTION (0.5<=risk<0.75) | CRITICAL (risk>=0.75)

Return ONLY raw JSON, no markdown, no explanation outside the JSON:
{{
  "risk_score": <float 0.0 to 1.0>,
  "market_signal": "<SAFE | CAUTION | CRITICAL>",
  "reasoning": "<one sentence max>",
  "data_timestamp": "<ISO timestamp from the data or N/A>"
}}
"""
            result = gl.nondet.exec_prompt(prompt)
            clean = result.strip()
            if clean.startswith("`"):
                clean = clean.split("\n", 1)[-1]
            if clean.endswith("`"):
                clean = clean.rsplit("\n", 1)[0]
            clean = clean.strip()

            try:
                parsed = json.loads(clean)
                for key in ["risk_score", "market_signal", "reasoning", "data_timestamp"]:
                    if key not in parsed:
                        raise gl.vm.UserError(f"Missing key: {key}")
                parsed["oracles_available"] = oracles_available
                return json.dumps(parsed)
            except Exception as e:
                return json.dumps({
                    "risk_score": 0.0,
                    "market_signal": "SAFE",
                    "reasoning": f"Parse failed: {str(e)}",
                    "data_timestamp": "N/A",
                    "oracles_available": oracles_available
                })

        consensus_json_str = ""
        try:
            consensus_json_str = gl.eq_principle.prompt_non_comparative(
                run_analysis,
                task="Analyze DAO risk from multi-oracle market data and output JSON",
                criteria="The JSON output must have equivalent 'market_signal' values across validators. Minor risk_score variations are acceptable."
            )

            clean_consensus = consensus_json_str.strip()
            if clean_consensus.startswith("`"):
                clean_consensus = clean_consensus.split("\n", 1)[-1]
            if clean_consensus.endswith("`"):
                clean_consensus = clean_consensus.rsplit("\n", 1)[0]
            clean_consensus = clean_consensus.strip()

            parsed_consensus = json.loads(clean_consensus)

            if isinstance(parsed_consensus, list) and len(parsed_consensus) > 0:
                decision = parsed_consensus[0]
            elif isinstance(parsed_consensus, dict):
                if "validators" in parsed_consensus:
                    validators = parsed_consensus.get("validators", [])
                    decision = validators[0] if validators else parsed_consensus
                elif "validator_1" in parsed_consensus:
                    decision = parsed_consensus["validator_1"]
                else:
                    decision = parsed_consensus
            else:
                decision = parsed_consensus

            # ── FIX [Issue 3]: Deterministic Python math decides the trade ──────
            # The LLM outputs only a risk_score float. Python's > operator
            # makes the binary authorize_trade decision — no floating-point
            # ambiguity from the LLM.
            actual_risk = float(decision.get("risk_score", 0.0))
            authorize_trade = actual_risk > risk_limit

            if authorize_trade:
                arc_contract = TreasuryRebalancer(self.treasury_address)
                arc_contract.emit(on="finalized").rebalance(
                    u256(int(self.speed_limit) * 100),   # convert % to basis points
                    decision.get("market_signal", "CRITICAL")
                )
                audit_entry = {
                    "action": "TRADE_AUTHORIZED",
                    "speed_limit_applied": int(self.speed_limit),
                    "protection_slippage_used": int(self.protection_slippage),
                    "risk_limit": risk_limit,
                    "actual_risk": actual_risk,
                    "oracles_available": decision.get("oracles_available", 0),
                    "ai_decision": decision
                }
                self.audit_logs.append(json.dumps(audit_entry))
                return f"Trade Authorized: {decision.get('reasoning')}"
            else:
                audit_entry = {
                    "action": "HEARTBEAT_SAFE",
                    "risk_limit": risk_limit,
                    "actual_risk": actual_risk,
                    "oracles_available": decision.get("oracles_available", 0),
                    "ai_decision": decision
                }
                self.audit_logs.append(json.dumps(audit_entry))
                return f"Heartbeat Safe: {decision.get('reasoning')}"

        except Exception as e:
            self.audit_logs.append(json.dumps({
                "action": "ERROR",
                "message": str(e),
                "raw_output": consensus_json_str
            }))
            return f"Error executing heartbeat: {str(e)}"

    @gl.public.write
    def heartbeat_for(self, treasury_address: Address) -> str:
        """
        User-specific heartbeat for the multi-tenant demo.
        Runs the same AI market analysis as heartbeat() but targets a specific
        treasury_address (the caller's personal demo contract on Arc).

        The Arc transaction is NOT triggered via gl.eq_principle emit here —
        the backend relayer reads this result and submits the Arc tx directly
        to the user's TreasuryRebalancerDemo contract. This keeps self.treasury_address
        (the main DAO treasury) completely unaffected by demo heartbeats.
        """
        # Deterministic risk limit — same as heartbeat()
        risk_limit = int(self.risk_tolerance_pct) / 100.0

        def run_analysis() -> str:
            oracle_results = {}

            # Oracle 1 — Alternative.me Fear & Greed Index
            try:
                raw = gl.nondet.web.render("https://api.alternative.me/fng/", mode="text")
                oracle_results["alternative_me_fng"] = raw[:400]
            except Exception as e:
                oracle_results["alternative_me_fng"] = f"UNAVAILABLE: {str(e)}"

            # Oracle 2 — CoinGecko BTC simple price
            try:
                raw = gl.nondet.web.render(
                    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true",
                    mode="text"
                )
                oracle_results["coingecko_btc"] = raw[:400]
            except Exception as e:
                oracle_results["coingecko_btc"] = f"UNAVAILABLE: {str(e)}"

            # Oracle 3 — Coinpaprika BTC ticker
            try:
                raw = gl.nondet.web.render(
                    "https://api.coinpaprika.com/v1/tickers/btc-bitcoin?quotes=USD",
                    mode="text"
                )
                oracle_results["coinpaprika_btc"] = raw[:400]
            except Exception as e:
                oracle_results["coinpaprika_btc"] = f"UNAVAILABLE: {str(e)}"

            all_failed = all("UNAVAILABLE" in v for v in oracle_results.values())
            if all_failed:
                return json.dumps({
                    "risk_score": 0.0,
                    "market_signal": "SAFE",
                    "reasoning": "All market data oracles are currently unavailable. Defaulting to safe posture.",
                    "data_timestamp": "N/A",
                    "oracles_available": 0
                })

            oracles_available = sum(1 for v in oracle_results.values() if "UNAVAILABLE" not in v)

            prompt = f"""
You are a DAO treasury risk analyst. Your ONLY job is to read the market data
below and extract a risk score. Do NOT decide whether to trade.

--- MARKET DATA (use all available sources, ignore UNAVAILABLE ones) ---
Alternative.me Fear & Greed: {oracle_results["alternative_me_fng"]}
CoinGecko BTC Price:         {oracle_results["coingecko_btc"]}
Coinpaprika BTC Ticker:      {oracle_results["coinpaprika_btc"]}
--- END DATA ---

Instructions:
- Read the Fear & Greed value from Alternative.me (0=extreme panic/fear, 100=extreme greed/bull market).
- Convert it to a `risk_score` between 0.0 (safe) and 1.0 (maximum danger).
  IMPORTANT INVERSION: We want HIGH risk when the market is crashing!
  So an Extreme Fear value of 11 MUST map to a HIGH risk_score of 0.89 (i.e., 1.0 - 0.11).
  A Greed value of 75 must map to a LOW risk_score of 0.25 (i.e., 1.0 - 0.75).
- If Alternative.me is UNAVAILABLE, derive risk_score from price momentum in the other sources.
- Assign market_signal: SAFE (risk<0.5) | CAUTION (0.5<=risk<0.75) | CRITICAL (risk>=0.75)

Return ONLY raw JSON, no markdown, no explanation outside the JSON:
{{
  "risk_score": <float 0.0 to 1.0>,
  "market_signal": "<SAFE | CAUTION | CRITICAL>",
  "reasoning": "<one sentence max>",
  "data_timestamp": "<ISO timestamp from the data or N/A>"
}}
"""
            result = gl.nondet.exec_prompt(prompt)
            clean = result.strip()
            if clean.startswith("`"):
                clean = clean.split("\n", 1)[-1]
            if clean.endswith("`"):
                clean = clean.rsplit("\n", 1)[0]
            clean = clean.strip()

            try:
                parsed = json.loads(clean)
                for key in ["risk_score", "market_signal", "reasoning", "data_timestamp"]:
                    if key not in parsed:
                        raise gl.vm.UserError(f"Missing key: {key}")
                parsed["oracles_available"] = oracles_available
                return json.dumps(parsed)
            except Exception as e:
                return json.dumps({
                    "risk_score": 0.0,
                    "market_signal": "SAFE",
                    "reasoning": f"Parse failed: {str(e)}",
                    "data_timestamp": "N/A",
                    "oracles_available": oracles_available
                })

        consensus_json_str = ""
        try:
            consensus_json_str = gl.eq_principle.prompt_non_comparative(
                run_analysis,
                task="Analyze DAO risk from multi-oracle market data and output JSON",
                criteria="The JSON output must have equivalent 'market_signal' values across validators."
            )

            clean_consensus = consensus_json_str.strip()
            if clean_consensus.startswith("`"):
                clean_consensus = clean_consensus.split("\n", 1)[-1]
            if clean_consensus.endswith("`"):
                clean_consensus = clean_consensus.rsplit("\n", 1)[0]
            clean_consensus = clean_consensus.strip()

            parsed_consensus = json.loads(clean_consensus)

            if isinstance(parsed_consensus, list) and len(parsed_consensus) > 0:
                decision = parsed_consensus[0]
            elif isinstance(parsed_consensus, dict):
                if "validators" in parsed_consensus:
                    validators = parsed_consensus.get("validators", [])
                    decision = validators[0] if validators else parsed_consensus
                elif "validator_1" in parsed_consensus:
                    decision = parsed_consensus["validator_1"]
                else:
                    decision = parsed_consensus
            else:
                decision = parsed_consensus

            # ── Deterministic Python math decides the trade (same as heartbeat) ──
            actual_risk = float(decision.get("risk_score", 0.0))
            authorize_trade = actual_risk > risk_limit

            # NOTE: We do NOT call arc_contract.emit() here.
            # The backend relayer (heartbeat-for/route.js) reads this audit log
            # entry and submits the Arc tx directly to the user's demo contract.
            if authorize_trade:
                audit_entry = {
                    "action": "TRADE_AUTHORIZED",
                    "demo": True,
                    "target_treasury": str(treasury_address),
                    "speed_limit_applied": int(self.speed_limit),
                    "protection_slippage_used": int(self.protection_slippage),
                    "risk_limit": risk_limit,
                    "actual_risk": actual_risk,
                    "oracles_available": decision.get("oracles_available", 0),
                    "ai_decision": decision
                }
                self.audit_logs.append(json.dumps(audit_entry))
                return f"Trade Authorized (demo): {decision.get('reasoning')}"
            else:
                audit_entry = {
                    "action": "HEARTBEAT_SAFE",
                    "demo": True,
                    "target_treasury": str(treasury_address),
                    "risk_limit": risk_limit,
                    "actual_risk": actual_risk,
                    "oracles_available": decision.get("oracles_available", 0),
                    "ai_decision": decision
                }
                self.audit_logs.append(json.dumps(audit_entry))
                return f"Heartbeat Safe (demo): {decision.get('reasoning')}"

        except Exception as e:
            self.audit_logs.append(json.dumps({
                "action": "ERROR",
                "demo": True,
                "target_treasury": str(treasury_address),
                "message": str(e),
                "raw_output": consensus_json_str
            }))
            return f"Error in heartbeat_for: {str(e)}"
