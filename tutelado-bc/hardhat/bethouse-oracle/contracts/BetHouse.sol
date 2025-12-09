// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Interfaz compatible con Chainlink
interface AggregatorV3Interface {
    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );
}

/// @notice Interfaz compatible con Chainlink Automation
interface AutomationCompatibleInterface {
    function checkUpkeep(bytes calldata checkData)
        external
        returns (bool upkeepNeeded, bytes memory performData);

    function performUpkeep(bytes calldata performData) external;
}

/// @title BetHouse multi-mercado
contract BetHouse is Ownable, ReentrancyGuard, AutomationCompatibleInterface {
    using SafeERC20 for IERC20;

    IERC20 public immutable collateral;

    uint16 public constant FEE_BET_BPS        = 200; // 2%
    uint64 public constant ROUND_SECONDS      = 100; // duración total ronda
    uint64 public constant BET_WINDOW_SECONDS = 60;  // ventana de apuestas

    // ──────────────────────────────────────────────────────────
    // Mercados
    // ──────────────────────────────────────────────────────────

    struct MarketConfig {
        AggregatorV3Interface feed;
        bool enabled;
    }

    // marketId => config (ej. marketId = keccak256("BTC/USD"))
    mapping(bytes32 => MarketConfig) public markets;

    // ──────────────────────────────────────────────────────────
    // Rondas y apuestas
    // ──────────────────────────────────────────────────────────

    struct Round {
        uint64  startTime;
        uint64  endTime;
        bool    active;
        bool    resolved;
        bool    outcomeYes;   // solo si !refundMode
        bool    refundMode;   // true => devolvemos todo
        uint256 totalYesNet;  // suma de netos YES
        uint256 totalNoNet;   // suma de netos NO
        uint256 feeAccrued;   // fees acumuladas en esta ronda
        bytes32 marketId;     // mercado asociado
        int256  priceStart;   // precio al inicio (feed)
        int256  priceEnd;     // precio al cierre (feed)
    }

    /// @notice Apuesta agregada por usuario y lado
    struct BetInfo {
        uint256 gross; // total apostado bruto
        uint256 net;   // total neto tras fee
    }

    uint256 public currentRoundId;
    mapping(uint256 => Round) public rounds;

    // betsYes[id][user], betsNo[id][user]
    mapping(uint256 => mapping(address => BetInfo)) public betsYes;
    mapping(uint256 => mapping(address => BetInfo)) public betsNo;

    // control de cobros/reembolsos
    mapping(uint256 => mapping(address => bool)) public claimed;

    // fees globales retirables por el owner
    uint256 public feeVault;

    // ──────────────────────────────────────────────────────────
    // Eventos
    // ──────────────────────────────────────────────────────────

    event MarketAdded(bytes32 indexed id, address feed);
    event MarketStatusChanged(bytes32 indexed id, bool enabled);

    event RoundStarted(
        uint256 indexed id,
        bytes32 indexed marketId,
        uint64 startTime,
        uint64 endTime,
        int256 priceStart
    );

    event BetPlaced(
        address indexed user,
        uint256 indexed id,
        bool isYes,
        uint256 gross,
        uint256 net,
        uint256 fee
    );

    event RoundResolved(
        uint256 indexed id,
        bool refundMode,
        bool outcomeYes,
        int256 priceStart,
        int256 priceEnd
    );

    event Claimed(address indexed user, uint256 indexed id, uint256 payout);
    event Refunded(address indexed user, uint256 indexed id, uint256 amount);
    event FeesWithdrawn(address indexed to, uint256 amount);

    // ──────────────────────────────────────────────────────────
    // Errores
    // ──────────────────────────────────────────────────────────

    error ErrActiveRound();
    error ErrNoActive();
    error ErrTooEarly();
    error ErrTooLate();
    error ErrZero();
    error ErrBadRound();
    error ErrNotResolved();
    error ErrAlreadyClaimed();
    error ErrNoWin();
    error ErrBadMarket();

    // ──────────────────────────────────────────────────────────
    // Constructor
    // ──────────────────────────────────────────────────────────

    constructor(address _collateral, address _owner) Ownable(_owner) {
        require(_collateral != address(0), "zero collateral");
        collateral = IERC20(_collateral);
    }

    // ──────────────────────────────────────────────────────────
    // Gestión de mercados (multi-asset)
    // ──────────────────────────────────────────────────────────

    function addMarket(bytes32 id, address feed) external onlyOwner {
        require(feed != address(0), "zero feed");
        markets[id] = MarketConfig({
            feed: AggregatorV3Interface(feed),
            enabled: true
        });
        emit MarketAdded(id, feed);
    }

    function setMarketEnabled(bytes32 id, bool enabled) external onlyOwner {
        MarketConfig storage m = markets[id];
        if (address(m.feed) == address(0)) revert ErrBadMarket();
        m.enabled = enabled;
        emit MarketStatusChanged(id, enabled);
    }

    function getMarket(bytes32 id)
        external
        view
        returns (address feed, bool enabled)
    {
        MarketConfig storage m = markets[id];
        return (address(m.feed), m.enabled);
    }

    function _getLatestPrice(bytes32 marketId) internal view returns (int256) {
        MarketConfig storage m = markets[marketId];
        if (!m.enabled || address(m.feed) == address(0)) revert ErrBadMarket();

        (
            /* uint80 roundId */,
            int256 answer,
            /* uint256 startedAt */,
            uint256 updatedAt,
            /* uint80 answeredInRound */
        ) = m.feed.latestRoundData();

        require(answer > 0, "invalid price");
        require(updatedAt != 0, "stale price");
        return answer;
    }

    // ──────────────────────────────────────────────────────────
    // Gestión de rondas
    // ──────────────────────────────────────────────────────────

    /// @notice Inicia una nueva ronda para un mercado concreto
    function startRound(bytes32 marketId) external onlyOwner {
        MarketConfig storage m = markets[marketId];
        if (!m.enabled || address(m.feed) == address(0)) revert ErrBadMarket();

        if (currentRoundId != 0) {
            Round storage prev = rounds[currentRoundId];
            if (prev.active && block.timestamp < prev.endTime) {
                revert ErrActiveRound();
            }
        }

        int256 priceStart = _getLatestPrice(marketId);

        uint256 id = currentRoundId + 1;
        currentRoundId = id;

        rounds[id] = Round({
            startTime:   uint64(block.timestamp),
            endTime:     uint64(block.timestamp + ROUND_SECONDS),
            active:      true,
            resolved:    false,
            outcomeYes:  false,
            refundMode:  false,
            totalYesNet: 0,
            totalNoNet:  0,
            feeAccrued:  0,
            marketId:    marketId,
            priceStart:  priceStart,
            priceEnd:    0
        });

        emit RoundStarted(
            id,
            marketId,
            rounds[id].startTime,
            rounds[id].endTime,
            priceStart
        );
    }

    /// @notice Cierra una ronda leyendo el precio final del feed del mercado asociado.
    function endRound(uint256 id) public {
        if (id == 0 || id > currentRoundId) revert ErrBadRound();
        Round storage r = rounds[id];
        if (!r.active) revert ErrNoActive();
        if (r.resolved) revert ErrBadRound();

        bool yesHas = r.totalYesNet > 0;
        bool noHas  = r.totalNoNet  > 0;

        uint64 betWindowClose = r.startTime + BET_WINDOW_SECONDS;

        if (yesHas && noHas) {
            // modo normal: hay apuestas en ambos lados
            if (block.timestamp < r.endTime) revert ErrTooEarly();

            int256 priceEnd = _getLatestPrice(r.marketId);
            r.priceEnd = priceEnd;

            r.active   = false;
            r.resolved = true;

            if (priceEnd == r.priceStart) {
                // (3) Empate exacto => devolvemos todo (refundMode)
                r.refundMode = true;
                r.outcomeYes = false;
            } else {
                // subida => gana YES, bajada => gana NO
                r.refundMode = false;
                r.outcomeYes = priceEnd > r.priceStart;
                feeVault    += r.feeAccrued;
            }
        } else {
            // modo refund: solo hubo un lado (o ninguno)
            if (block.timestamp < betWindowClose) revert ErrTooEarly();

            r.active     = false;
            r.resolved   = true;
            r.refundMode = true;
            r.outcomeYes = false;
        }

        emit RoundResolved(
            id,
            r.refundMode,
            r.outcomeYes,
            r.priceStart,
            r.priceEnd
        );
    }

    // ──────────────────────────────────────────────────────────
    // Apuestas
    // ──────────────────────────────────────────────────────────

    function betYes(uint256 id, uint256 amount) external nonReentrant {
        _bet(id, amount, true);
    }

    function betNo(uint256 id, uint256 amount) external nonReentrant {
        _bet(id, amount, false);
    }

    function _bet(uint256 id, uint256 amount, bool isYes) internal {
        if (amount == 0) revert ErrZero();
        Round storage r = rounds[id];
        if (!r.active) revert ErrNoActive();
        if (block.timestamp >= r.endTime) revert ErrTooLate();
        if (block.timestamp > r.startTime + BET_WINDOW_SECONDS) revert ErrTooLate();

        collateral.safeTransferFrom(msg.sender, address(this), amount);

        uint256 fee = (amount * FEE_BET_BPS) / 10_000;
        uint256 net = amount - fee;

        r.feeAccrued += fee;

        BetInfo storage bet = isYes
            ? betsYes[id][msg.sender]
            : betsNo[id][msg.sender];

        bet.gross += amount;
        bet.net   += net;

        if (isYes) {
            r.totalYesNet += net;
        } else {
            r.totalNoNet  += net;
        }

        emit BetPlaced(msg.sender, id, isYes, amount, net, fee);
    }

    // ──────────────────────────────────────────────────────────
    // Claim ganadores
    // ──────────────────────────────────────────────────────────

    function claim(uint256 id) external nonReentrant {
        Round storage r = rounds[id];
        if (!r.resolved) revert ErrNotResolved();
        if (r.refundMode) revert ErrBadRound();
        if (claimed[id][msg.sender]) revert ErrAlreadyClaimed();

        BetInfo storage bet = r.outcomeYes
            ? betsYes[id][msg.sender]
            : betsNo[id][msg.sender];

        uint256 userNet = bet.net;
        if (userNet == 0) revert ErrNoWin();

        uint256 winnersTotal = r.outcomeYes ? r.totalYesNet : r.totalNoNet;
        uint256 pool = r.totalYesNet + r.totalNoNet;

        // consumimos stake del usuario
        bet.net   = 0;
        bet.gross = 0;
        claimed[id][msg.sender] = true;

        uint256 payout = (pool * userNet) / winnersTotal;

        collateral.safeTransfer(msg.sender, payout);
        emit Claimed(msg.sender, id, payout);
    }

    // ──────────────────────────────────────────────────────────
    // Refund íntegro
    // ──────────────────────────────────────────────────────────

    function refund(uint256 id) external nonReentrant {
        Round storage r = rounds[id];
        if (!r.resolved) revert ErrNotResolved();
        if (!r.refundMode) revert ErrBadRound();
        if (claimed[id][msg.sender]) revert ErrAlreadyClaimed();

        BetInfo storage yesBet = betsYes[id][msg.sender];
        BetInfo storage noBet  = betsNo[id][msg.sender];

        uint256 gross = yesBet.gross;
        if (gross == 0) {
            gross = noBet.gross;
        }
        if (gross == 0) revert ErrNoWin();

        yesBet.gross = 0;
        yesBet.net   = 0;
        noBet.gross  = 0;
        noBet.net    = 0;
        claimed[id][msg.sender] = true;

        collateral.safeTransfer(msg.sender, gross);
        emit Refunded(msg.sender, id, gross);
    }

    // ──────────────────────────────────────────────────────────
    // Retiro de fees por el owner
    // ──────────────────────────────────────────────────────────

    function withdrawFees(address to, uint256 amount)
        external
        onlyOwner
        nonReentrant
    {
        require(to != address(0), "bad to");
        require(amount <= feeVault, "exceeds vault");
        feeVault -= amount;
        collateral.safeTransfer(to, amount);
        emit FeesWithdrawn(to, amount);
    }

    // ──────────────────────────────────────────────────────────
    // Chainlink Automation
    // ──────────────────────────────────────────────────────────

    function checkUpkeep(
        bytes calldata /* checkData */
    ) external override returns (bool upkeepNeeded, bytes memory performData) {
        uint256 id = currentRoundId;
        if (id == 0) {
            return (false, bytes(""));
        }

        Round storage r = rounds[id];
        if (!r.active || r.resolved) {
            return (false, bytes(""));
        }

        bool yesHas = r.totalYesNet > 0;
        bool noHas  = r.totalNoNet  > 0;
        uint64 betWindowClose = r.startTime + BET_WINDOW_SECONDS;

        uint64 targetTime = yesHas && noHas ? r.endTime : betWindowClose;

        if (block.timestamp >= targetTime) {
            upkeepNeeded = true;
            performData = abi.encode(id);
        } else {
            upkeepNeeded = false;
            performData = bytes("");
        }
    }

    /// @notice performUpkeep: llama a endRound(id).
    function performUpkeep(bytes calldata performData) external override {
        uint256 id = abi.decode(performData, (uint256));
        endRound(id);
    }
}

