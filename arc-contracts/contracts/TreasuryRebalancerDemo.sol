// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title  TreasuryRebalancerDemo
 * @notice Lightweight demo contract deployed per-user for the AutoHedge live demo.
 *         Simulates a DAO treasury without requiring real tokens or a DEX router.
 *         The AI heartbeat backend calls rebalance() after GenLayer consensus,
 *         producing a REAL, verifiable Arc transaction with the user's wallet address.
 *
 * @dev    No real swaps happen. Demo balances are tracked in storage and the
 *         RebalanceExecuted event is emitted — visible on the Arc explorer.
 */
contract TreasuryRebalancerDemo {

    // ── State ─────────────────────────────────────────────────────────────────
    address public owner;           // User's wallet address (set at deploy)
    address public relayer;         // Backend relayer wallet (our server key)

    // Simulated treasury holdings (no real tokens)
    uint256 public demoWETHBalance; // Starts at 1000 mWETH (in 18-decimal units)
    uint256 public demoUSDCBalance; // Accumulated from simulated swaps
    uint256 public totalRebalances; // Count of heartbeat calls

    // ── Events ────────────────────────────────────────────────────────────────
    /**
     * @notice Emitted on every heartbeat — SAFE or CRITICAL.
     *         The `userWallet` field lets the owner find their tx on ArcScan.
     */
    event RebalanceExecuted(
        address indexed userWallet,
        uint256         percentBps,
        uint256         amountSimulated,
        string          signal
    );

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event RelayerUpdated(address indexed newRelayer);

    // ── Modifiers ─────────────────────────────────────────────────────────────
    modifier onlyOwner() {
        require(msg.sender == owner, "Demo: not owner");
        _;
    }

    modifier onlyAuthorized() {
        require(
            msg.sender == owner || msg.sender == relayer,
            "Demo: not authorized"
        );
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────────
    /**
     * @param _owner    The user's wallet address that owns this demo treasury
     * @param _relayer  The backend relayer that is allowed to call rebalance()
     */
    constructor(address _owner, address _relayer) {
        require(_owner   != address(0), "Demo: invalid owner");
        require(_relayer != address(0), "Demo: invalid relayer");

        owner            = _owner;
        relayer          = _relayer;
        demoWETHBalance  = 1_000 ether; // Start with 1,000 simulated WETH
        demoUSDCBalance  = 0;
        totalRebalances  = 0;
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Demo: invalid address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setRelayer(address newRelayer) external onlyOwner {
        require(newRelayer != address(0), "Demo: invalid address");
        relayer = newRelayer;
        emit RelayerUpdated(newRelayer);
    }

    // ── Core: AI-authorised rebalance ─────────────────────────────────────────

    /**
     * @notice Called by the AutoHedge backend relayer after GenLayer AI consensus.
     *
     * @param percentBps  Percentage of demo WETH to "sell", in basis points.
     *                    0 = SAFE heartbeat (no swap, just records the event).
     *                    > 0 = CRITICAL / CAUTION (simulates the swap).
     * @param signal      AI market signal: "SAFE" | "CAUTION" | "CRITICAL"
     *
     * @dev  No real tokens are moved. Demo balances update in storage so the
     *       user can see their portfolio shifting over time in the dashboard.
     *       The emitted event is fully verifiable on the Arc block explorer.
     */
    function rebalance(uint256 percentBps, string memory signal)
        external
        onlyAuthorized
        returns (bool)
    {
        require(percentBps <= 10_000, "Demo: percentBps > 100%");

        uint256 amountSimulated = 0;

        if (percentBps > 0 && demoWETHBalance > 0) {
            // Simulate the swap: move percentBps of WETH into USDC (1:1 for demo)
            amountSimulated   = (demoWETHBalance * percentBps) / 10_000;
            demoWETHBalance  -= amountSimulated;
            demoUSDCBalance  += amountSimulated;
        }

        totalRebalances++;

        emit RebalanceExecuted(owner, percentBps, amountSimulated, signal);
        return true;
    }

    // ── View helpers ──────────────────────────────────────────────────────────

    function getBalances() external view returns (uint256 weth, uint256 usdc) {
        return (demoWETHBalance, demoUSDCBalance);
    }

    function getInfo() external view returns (
        address _owner,
        address _relayer,
        uint256 _weth,
        uint256 _usdc,
        uint256 _rebalances
    ) {
        return (owner, relayer, demoWETHBalance, demoUSDCBalance, totalRebalances);
    }
}
