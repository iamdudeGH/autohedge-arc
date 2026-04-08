// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./MockERC20.sol";

/**
 * @title  MockSwapRouter
 * @notice Simulates a Uniswap V3 SwapRouter for Arc testnet.
 *         Instead of a real swap it just transfers tokenIn → itself and mints
 *         a 1:1 equivalent of tokenOut back.  Slippage is always satisfied.
 *
 * @dev    The router must be minted tokenOut supply by the deployer so it has
 *         tokens to send back.  See the setup script.
 */
contract MockSwapRouter {

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

    event MockSwapExecuted(
        address indexed tokenIn,
        address indexed tokenOut,
        uint256         amountIn,
        uint256         amountOut,
        address         recipient
    );

    /**
     * @notice "Swaps" tokenIn for tokenOut at a fixed 1:1 rate (testnet only).
     *         Pulls tokenIn from the caller, sends tokenOut to recipient.
     */
    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        returns (uint256 amountOut)
    {
        require(block.timestamp <= params.deadline, "Swap deadline exceeded");
        require(params.amountIn > 0, "Zero amountIn");

        // Pull tokenIn from caller
        MockERC20(params.tokenIn).transferFrom(
            msg.sender, address(this), params.amountIn
        );

        // Return 1:1 amountOut (simulates swap, ignores price)
        amountOut = params.amountIn;
        require(amountOut >= params.amountOutMinimum, "Slippage exceeded");

        // Send tokenOut to recipient
        MockERC20(params.tokenOut).transfer(params.recipient, amountOut);

        emit MockSwapExecuted(
            params.tokenIn,
            params.tokenOut,
            params.amountIn,
            amountOut,
            params.recipient
        );

        return amountOut;
    }
}
