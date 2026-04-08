// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ─── Minimal ERC-20 interface (no OZ import required for testnet) ────────────
interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

// ─── Uniswap V3 SwapRouter interface stub ────────────────────────────────────
interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24  fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata params)
        external returns (uint256 amountOut);
}

/**
 * @title  TreasuryRebalancer
 * @notice Holds DAO treasury tokens and executes AI-authorised swaps via a
 *         Uniswap V3-compatible DEX router.  The `rebalance()` function is
 *         called exclusively by the GenLayer Intelligent Contract relayer.
 */
contract TreasuryRebalancer {

    // ── State ─────────────────────────────────────────────────────────────────
    address public owner;
    address public relayer;          // GenLayer EVM relayer address
    address public swapRouter;       // DEX router (Uniswap V3-compatible)
    address public tokenIn;          // Volatile token to sell  (e.g. WETH)
    address public tokenOut;         // Stable destination      (e.g. USDC)
    uint24  public poolFee;          // Uniswap pool fee tier   (e.g. 3000 = 0.3 %)
    uint256 public slippageBps;      // Max acceptable slippage in basis points

    // ── Events ────────────────────────────────────────────────────────────────
    event RebalanceExecuted(
        address indexed caller,
        uint256 amountIn,
        uint256 amountOut,
        string  signal
    );
    event Deposited(address indexed token, uint256 amount);
    event EmergencyWithdraw(address indexed token, uint256 amount);
    event RelayerUpdated(address indexed newRelayer);
    event RouterUpdated(address indexed newRouter);

    // ── Modifiers ─────────────────────────────────────────────────────────────
    modifier onlyOwner() {
        require(msg.sender == owner, "TreasuryRebalancer: not owner");
        _;
    }

    modifier onlyAuthorized() {
        require(
            msg.sender == owner || msg.sender == relayer,
            "TreasuryRebalancer: not authorized"
        );
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────────
    /**
     * @param _swapRouter  Address of Uniswap V3 SwapRouter (or compatible DEX)
     * @param _tokenIn     Volatile asset the DAO wants to hedge (e.g. WETH)
     * @param _tokenOut    Safe-haven asset to receive        (e.g. USDC)
     * @param _poolFee     Uniswap V3 fee tier               (500 | 3000 | 10000)
     * @param _slippageBps Maximum slippage in basis points  (e.g. 200 = 2 %)
     */
    constructor(
        address _swapRouter,
        address _tokenIn,
        address _tokenOut,
        uint24  _poolFee,
        uint256 _slippageBps
    ) {
        require(_swapRouter != address(0), "Invalid router");
        require(_tokenIn   != address(0), "Invalid tokenIn");
        require(_tokenOut  != address(0), "Invalid tokenOut");

        owner       = msg.sender;
        relayer     = msg.sender;   // owner acts as relayer until updated
        swapRouter  = _swapRouter;
        tokenIn     = _tokenIn;
        tokenOut    = _tokenOut;
        poolFee     = _poolFee;
        slippageBps = _slippageBps;
    }

    // ── Admin functions ───────────────────────────────────────────────────────

    /// @notice Transfer contract ownership
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid address");
        owner = newOwner;
    }

    /// @notice Update the GenLayer relayer address (called once relayer is known)
    function setRelayer(address newRelayer) external onlyOwner {
        require(newRelayer != address(0), "Invalid address");
        relayer = newRelayer;
        emit RelayerUpdated(newRelayer);
    }

    /// @notice Update the DEX swap router
    function setSwapRouter(address newRouter) external onlyOwner {
        require(newRouter != address(0), "Invalid address");
        swapRouter = newRouter;
        emit RouterUpdated(newRouter);
    }

    /// @notice Update slippage protection (in basis points)
    function setSlippage(uint256 newSlippageBps) external onlyOwner {
        require(newSlippageBps <= 1000, "Slippage > 10%");
        slippageBps = newSlippageBps;
    }

    // ── Funding ───────────────────────────────────────────────────────────────

    /**
     * @notice Deposit ERC-20 tokens into the treasury.
     * @param token   Token contract address
     * @param amount  Amount in token's native decimals
     */
    function deposit(address token, uint256 amount) external {
        require(amount > 0, "Amount must be > 0");
        bool ok = IERC20(token).transferFrom(msg.sender, address(this), amount);
        require(ok, "Transfer failed");
        emit Deposited(token, amount);
    }

    /// @notice View the treasury balance of any ERC-20 token
    function balanceOf(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    // ── Core rebalance ────────────────────────────────────────────────────────

    /**
     * @notice  AI-authorised swap: converts `percentBps` of the volatile
     *          `tokenIn` balance into `tokenOut` via the DEX router.
     *
     * @param   percentBps  Percentage of tokenIn balance to sell, in basis
     *                      points (e.g. 2500 = 25 %).  Capped at 10 000 (100 %).
     * @param   signal      Human-readable AI signal string ("CRITICAL", "CAUTION", etc.)
     *
     * @dev     Called exclusively by the GenLayer relayer after on-chain AI
     *          consensus is reached.  Slippage protection is enforced on-chain
     *          via `amountOutMinimum` derived from the stored `slippageBps`.
     */
    function rebalance(uint256 percentBps, string memory signal)
        external
        onlyAuthorized
        returns (bool)
    {
        require(percentBps > 0 && percentBps <= 10_000, "Invalid percentBps");

        uint256 balance = IERC20(tokenIn).balanceOf(address(this));
        require(balance > 0, "No tokenIn balance");

        // Calculate the sell amount based on the AI's speed-limit percentage
        uint256 amountIn = (balance * percentBps) / 10_000;

        // Approve the router to spend tokenIn
        bool approved = IERC20(tokenIn).approve(swapRouter, amountIn);
        require(approved, "Approve failed");

        // Build the swap params — amountOutMinimum enforces slippage protection
        // In production you would use a price oracle here; for testnet we use
        // a simple basis-point deduction relative to the input amount.
        uint256 amountOutMinimum = amountIn - (amountIn * slippageBps / 10_000);

        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter
            .ExactInputSingleParams({
                tokenIn:           tokenIn,
                tokenOut:          tokenOut,
                fee:               poolFee,
                recipient:         address(this),
                deadline:          block.timestamp + 300,   // 5-minute deadline
                amountIn:          amountIn,
                amountOutMinimum:  amountOutMinimum,
                sqrtPriceLimitX96: 0
            });

        uint256 amountOut = ISwapRouter(swapRouter).exactInputSingle(params);

        emit RebalanceExecuted(msg.sender, amountIn, amountOut, signal);
        return true;
    }

    // ── Safety hatch ──────────────────────────────────────────────────────────

    /**
     * @notice Emergency withdrawal of any ERC-20 token held by this contract.
     *         Owner-only.  Exists so the DAO can recover funds if the AI goes
     *         haywire or the contract needs to be migrated.
     */
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        require(amount > 0, "Amount must be > 0");
        bool ok = IERC20(token).transfer(owner, amount);
        require(ok, "Transfer failed");
        emit EmergencyWithdraw(token, amount);
    }
}
