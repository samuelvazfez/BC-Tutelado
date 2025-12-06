// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Mock muy simple compatible con AggregatorV3Interface.
contract MockV3Aggregator {
    uint8 public decimals;
    int256 private _answer;

    constructor(uint8 _decimals, int256 _initialAnswer) {
        decimals = _decimals;
        _answer = _initialAnswer;
    }

    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (0, _answer, block.timestamp, block.timestamp, 0);
    }

    /// @notice Para actualizar el precio en tus tests/scripts de Hardhat.
    function updateAnswer(int256 newAnswer) external {
        _answer = newAnswer;
    }
}
