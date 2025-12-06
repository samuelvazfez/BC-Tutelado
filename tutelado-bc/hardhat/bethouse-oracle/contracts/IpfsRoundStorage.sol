// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title Almacén de artefactos IPFS por ronda de BetHouse
/// @notice Guarda CIDs de JSON, recibo PDF y gráfica PNG para cada ronda
contract IpfsRoundStorage is Ownable {
    // roundId => CID JSON (reporte resumen)
    mapping(uint256 => string) public roundReports;

    // roundId => CID PDF (recibo)
    mapping(uint256 => string) public roundReceiptCid;

    // roundId => CID PNG (gráfica de precios)
    mapping(uint256 => string) public roundChartCid;

    event RoundReportSet(uint256 indexed roundId, string cid);
    event RoundReceiptSet(uint256 indexed roundId, string cid);
    event RoundChartSet(uint256 indexed roundId, string cid);

    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @notice Registra / actualiza el CID del JSON de una ronda
    /// @dev En la práctica, lo usará el bot-oráculo (owner)
    function setRoundReport(uint256 roundId, string calldata cid) external onlyOwner {
        require(bytes(cid).length > 0, "empty cid");
        roundReports[roundId] = cid;
        emit RoundReportSet(roundId, cid);
    }

    /// @notice Registra / actualiza el CID del PDF de recibo de una ronda
    function setRoundReceipt(uint256 roundId, string calldata cid) external onlyOwner {
        require(bytes(cid).length > 0, "empty cid");
        roundReceiptCid[roundId] = cid;
        emit RoundReceiptSet(roundId, cid);
    }

    /// @notice Registra / actualiza el CID de la grafica PNG de una ronda
    function setRoundChart(uint256 roundId, string calldata cid) external onlyOwner {
        require(bytes(cid).length > 0, "empty cid");
        roundChartCid[roundId] = cid;
        emit RoundChartSet(roundId, cid);
    }

    /// @notice Devuelve el CID del JSON de una ronda
    function getRoundReport(uint256 roundId) external view returns (string memory) {
        return roundReports[roundId];
    }
}
