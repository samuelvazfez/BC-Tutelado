// src/BettingPage.js
import React, { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import "./BettingPage.css";
import { addresses, abis } from "./contracts";

// Provider de sólo lectura contra tu nodo Hardhat
const rpcProvider = new ethers.providers.JsonRpcProvider(
  "http://127.0.0.1:8545"
);

// Config de mercados (por ahora sólo BTC/USD)
const MARKET_CONFIGS = [
  {
    id: ethers.utils.id("BTC/USD"), // Debe ser el mismo id que uses en addMarket
    symbol: "BTC/USD",
    label: "BTC / USD",
    question:
      "¿Será el precio de BTC/USD MAYOR que el precio de inicio de la ronda?",
  },
];

function shortAddress(addr) {
  if (!addr || addr.length < 10) return addr || "-";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatMck(x) {
  if (!x) return "-";
  const n = parseFloat(x);
  if (Number.isNaN(n)) return "-";
  return n.toFixed(2) + " MCK";
}

function secondsToHms(sec) {
  if (sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n) => n.toString().padStart(2, "0");
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

function BettingPage() {
  // wallet / signer
  const [walletAddress, setWalletAddress] = useState("");
  const [signer, setSigner] = useState(null);

  // contratos lectura
  const [betHouseRead, setBetHouseRead] = useState(null);
  const [collateralRead, setCollateralRead] = useState(null);

  // contratos escritura
  const betHouseWrite = useMemo(
    () => (signer && betHouseRead ? betHouseRead.connect(signer) : null),
    [signer, betHouseRead]
  );
  const collateralWrite = useMemo(
    () =>
      signer && collateralRead ? collateralRead.connect(signer) : null,
    [signer, collateralRead]
  );

  // mercado seleccionado
  const [selectedMarket, setSelectedMarket] = useState(MARKET_CONFIGS[0]);

  // ronda actual
  const [currentRoundId, setCurrentRoundId] = useState(null);
  const [round, setRound] = useState(null);
  const [roundSeconds, setRoundSeconds] = useState(0);
  const [betWindowSeconds, setBetWindowSeconds] = useState(0);

  // tiempo
  const [nowChain, setNowChain] = useState(0);
  const [status, setStatus] = useState("idle"); // "idle" | "noRound" | "betting" | "waiting" | "resolved"

  // precios
  const [startPrice, setStartPrice] = useState(null);
  const [endPrice, setEndPrice] = useState(null);
  const [feedDecimals, setFeedDecimals] = useState(8); // tu MockV3Aggregator probablemente usa 8
  const [feeBps, setFeeBps] = useState(0);

  // apuestas
  const [betsYes, setBetsYes] = useState([]);
  const [betsNo, setBetsNo] = useState([]);

  // usuario
  const [userBalance, setUserBalance] = useState("0");
  const [userAllowance, setUserAllowance] = useState("0");

  // UI
  const [amountInput, setAmountInput] = useState("10");
  const [txStatus, setTxStatus] = useState("");
  const [loading, setLoading] = useState(false);

  // ===== 1) Conectar contratos de lectura y wallet =====

  useEffect(() => {
    try {
      if (!addresses?.betHouse || !abis?.betHouse) {
        console.error("Falta dirección o ABI de BetHouse", {
          addresses,
          abis,
        });
        return;
      }
      if (!addresses?.collateral || !abis?.collateral) {
        console.error("Falta dirección o ABI de CollateralMock", {
          addresses,
          abis,
        });
        return;
      }

      const bh = new ethers.Contract(
        addresses.betHouse,
        abis.betHouse,
        rpcProvider
      );
      const col = new ethers.Contract(
        addresses.collateral,
        abis.collateral,
        rpcProvider
      );

      setBetHouseRead(bh);
      setCollateralRead(col);
    } catch (e) {
      console.error("Error creando contratos de lectura:", e);
    }
  }, []);

  useEffect(() => {
    async function connect() {
      if (!window.ethereum) return;
      const web3 = new ethers.providers.Web3Provider(window.ethereum);
      await web3.send("eth_requestAccounts", []);
      const s = web3.getSigner();
      const addr = await s.getAddress();
      setSigner(s);
      setWalletAddress(addr);
    }
    connect().catch(console.error);
  }, []);

  // ===== 2) Cargar parámetros globales (FEE, tiempos) =====

  useEffect(() => {
    if (!betHouseRead) return;
    async function loadGlobal() {
      try {
        const rSecs = await betHouseRead.ROUND_SECONDS();
        const wSecs = await betHouseRead.BET_WINDOW_SECONDS();
        const fee = await betHouseRead.FEE_BET_BPS();
        setRoundSeconds(rSecs.toNumber());
        setBetWindowSeconds(wSecs.toNumber());
        setFeeBps(fee.toNumber());
      } catch (e) {
        console.error("Error cargando parámetros globales:", e);
      }
    }
    loadGlobal();
  }, [betHouseRead]);

  // ===== 3) Cargar ronda actual del mercado seleccionado =====

  useEffect(() => {
    if (!betHouseRead || !selectedMarket) return;

    async function loadRound() {
      try {
        setLoading(true);
        setTxStatus("Cargando ronda…");

        const marketId = selectedMarket.id;

        // getMarket(bytes32) -> (address feed, bool enabled)
        try {
          const market = await betHouseRead.getMarket(marketId);
          const feed = market.feed ?? market[0];
          const enabled = market.enabled ?? market[1];

          if (!enabled || feed === ethers.constants.AddressZero) {
            setStatus("noRound");
            setCurrentRoundId(null);
            setRound(null);
            setTxStatus("Mercado no habilitado.");
            return;
          }

          // Para Hardhat/Mock, asumimos 8 decimales
          setFeedDecimals(8);
        } catch (e) {
          console.warn(
            "Error en getMarket (¿mercado aún no configurado?):",
            e
          );
          setStatus("noRound");
          setCurrentRoundId(null);
          setRound(null);
          setTxStatus("Mercado aún no configurado en el contrato.");
          return;
        }

        const rId = await betHouseRead.currentRoundId();
        if (rId.toNumber() === 0) {
          setStatus("noRound");
          setCurrentRoundId(null);
          setRound(null);
          setTxStatus("No hay ronda activa.");
          return;
        }

        const rStruct = await betHouseRead.rounds(rId);
        setCurrentRoundId(rId.toNumber());
        setRound(rStruct);
        setTxStatus("");
      } catch (e) {
        console.error("Error cargando ronda:", e);
        setTxStatus("No se pudo cargar la ronda.");
      } finally {
        setLoading(false);
      }
    }

    loadRound();
  }, [betHouseRead, selectedMarket]);

  // ===== 4) Actualizar tiempo y derivar estado de la ronda =====

  useEffect(() => {
    if (!round || !betWindowSeconds) return;

    let cancelled = false;

    async function updateTimeAndStatus() {
      try {
        const block = await rpcProvider.getBlock("latest");
        if (cancelled) return;
        const now = block.timestamp;
        setNowChain(now);

        const start = Number(round.startTime.toString());
        const end = Number(round.endTime.toString());
        const betEnd = start + betWindowSeconds;

        let newStatus = "idle";
        if (!round.active && !round.resolved) {
          newStatus = "noRound";
        } else if (round.active && now <= betEnd) {
          newStatus = "betting";
        } else if (round.active && now > betEnd && now <= end) {
          newStatus = "waiting";
        } else if (round.resolved) {
          newStatus = "resolved";
        }
        setStatus(newStatus);

        // Extraer precios de la struct Round (priceStart, priceEnd)
        const scale = 10 ** feedDecimals;

        const rawStart = round.priceStart;
        const rawEnd = round.priceEnd;

        if (rawStart && rawStart.toString() !== "0") {
          setStartPrice(Number(rawStart.toString()) / scale);
        } else {
          setStartPrice(null);
        }

        if (rawEnd && rawEnd.toString() !== "0") {
          setEndPrice(Number(rawEnd.toString()) / scale);
        } else {
          setEndPrice(null);
        }
      } catch (e) {
        console.error("Error actualizando tiempo/estado:", e);
      }
    }

    updateTimeAndStatus();
    const id = setInterval(updateTimeAndStatus, 500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [round, betWindowSeconds, feedDecimals]);

  // ===== 5) Cargar apuestas desde eventos BetPlaced =====

  useEffect(() => {
    if (!betHouseRead || currentRoundId == null) return;

    async function loadBets() {
      try {
        const filter = betHouseRead.filters.BetPlaced(
          null,
          currentRoundId,
          null,
          null
        );

        const logs = await rpcProvider.getLogs({
          fromBlock: 0,
          toBlock: "latest",
          address: addresses.betHouse,
          topics: filter.topics,
        });

        const yes = [];
        const no = [];

        logs.forEach((log) => {
          const parsed = betHouseRead.interface.parseLog(log);
          const { user, isYes, gross, net } = parsed.args;
          const bet = {
            user,
            gross: parseFloat(ethers.utils.formatEther(gross)),
            net: parseFloat(ethers.utils.formatEther(net)),
          };
          if (isYes) yes.push(bet);
          else no.push(bet);
        });

        setBetsYes(yes);
        setBetsNo(no);
      } catch (e) {
        console.error("Error cargando bets:", e);
      }
    }

    loadBets();
  }, [betHouseRead, currentRoundId]);

  // ===== 6) Balance y allowance del usuario =====

  useEffect(() => {
    if (!collateralRead || !walletAddress) return;

    async function loadUser() {
      try {
        const bal = await collateralRead.balanceOf(walletAddress);
        const alw = await collateralRead.allowance(
          walletAddress,
          addresses.betHouse
        );
        setUserBalance(ethers.utils.formatEther(bal));
        setUserAllowance(ethers.utils.formatEther(alw));
      } catch (e) {
        console.error("Error cargando usuario:", e);
      }
    }

    loadUser();
  }, [collateralRead, walletAddress, currentRoundId]);

  // ===== 7) Apostar YES / NO =====

  async function placeBet(isYes) {
    if (!betHouseWrite || !collateralWrite || !round || currentRoundId == null) {
      setTxStatus("Conecta tu wallet y espera a que cargue la ronda.");
      return;
    }

    if (status !== "betting") {
      setTxStatus("La ventana de apuestas no está abierta.");
      return;
    }

    let amount = amountInput.trim();
    if (!amount) amount = "0";

    try {
      const amountWei = ethers.utils.parseEther(amount);
      if (amountWei.lte(0)) {
        setTxStatus("Introduce un importe mayor que 0.");
        return;
      }

      setLoading(true);
      setTxStatus("Comprobando allowance…");

      const allowanceWei = ethers.utils.parseEther(userAllowance || "0");
      if (allowanceWei.lt(amountWei)) {
        setTxStatus("Aprobando uso de MCK para BetHouse…");
        const txApprove = await collateralWrite.approve(
          addresses.betHouse,
          amountWei
        );
        await txApprove.wait();
      }

      setTxStatus("Enviando apuesta…");
      const tx = isYes
        ? await betHouseWrite.betYes(currentRoundId, amountWei)
        : await betHouseWrite.betNo(currentRoundId, amountWei);
      await tx.wait();

      setTxStatus("Apuesta enviada correctamente.");
      setAmountInput("10");

      // recargar round y bets
      const rStruct = await betHouseRead.rounds(currentRoundId);
      setRound(rStruct);

      const bal = await collateralRead.balanceOf(walletAddress);
      const alw = await collateralRead.allowance(
        walletAddress,
        addresses.betHouse
      );
      setUserBalance(ethers.utils.formatEther(bal));
      setUserAllowance(ethers.utils.formatEther(alw.toString()));

      // recargar bets (igual que antes)
      const filter = betHouseRead.filters.BetPlaced(
        null,
        currentRoundId,
        null,
        null
      );
      const logs = await rpcProvider.getLogs({
        fromBlock: 0,
        toBlock: "latest",
        address: addresses.betHouse,
        topics: filter.topics,
      });
      const yes = [];
      const no = [];
      logs.forEach((log) => {
        const parsed = betHouseRead.interface.parseLog(log);
        const { user, isYes, gross, net } = parsed.args;
        const bet = {
          user,
          gross: parseFloat(ethers.utils.formatEther(gross)),
          net: parseFloat(ethers.utils.formatEther(net)),
        };
        if (isYes) yes.push(bet);
        else no.push(bet);
      });
      setBetsYes(yes);
      setBetsNo(no);
    } catch (e) {
      console.error("Error en apuesta:", e);
      setTxStatus(e.message || "Error enviando apuesta.");
    } finally {
      setLoading(false);
    }
  }

  // ===== 8) Derivados para UI =====

  let timeInfo = "";
  if (round && nowChain && betWindowSeconds && roundSeconds) {
    const start = Number(round.startTime.toString());
    const end = Number(round.endTime.toString());
    const betEnd = start + betWindowSeconds;

    if (status === "betting") {
      const remaining = betEnd - nowChain;
      timeInfo = `Ventana de apuestas abierta · Cierra en ${secondsToHms(
        remaining
      )}`;
    } else if (status === "waiting") {
      const remaining = end - nowChain;
      timeInfo = `Apuestas cerradas · Ronda termina en ${secondsToHms(
        remaining
      )}`;
    } else if (status === "resolved") {
      timeInfo = "Ronda resuelta";
    } else if (status === "noRound") {
      timeInfo = "No hay ronda activa.";
    }
  }

  const totalYesNet = round
    ? ethers.utils.formatEther(round.totalYesNet)
    : "0";
  const totalNoNet = round ? ethers.utils.formatEther(round.totalNoNet) : "0";

  const feePct = feeBps ? (feeBps / 100).toFixed(2) + "%" : "-";

  return (
    <div className="bet-app">
      <header className="bet-header">
        <div className="bet-header-left">
          <h1>BetHouse dApp</h1>
          <p className="bet-subtitle">
            Apuesta a la dirección del precio utilizando el token MCK sobre tu
            despliegue local.
          </p>
        </div>
        <div className="bet-header-right">
          <div className="wallet-info">
            <span>Wallet:</span>
            <strong>{walletAddress ? shortAddress(walletAddress) : "—"}</strong>
          </div>
          <div className="wallet-info">
            <span>Balance MCK:</span>
            <strong>{formatMck(userBalance)}</strong>
          </div>
        </div>
      </header>

      <main className="bet-main">
        {/* Selector de mercado */}
        <section className="bet-card">
          <div className="bet-card-header">
            <h2>Mercado</h2>
          </div>
          <div className="market-selector">
            {MARKET_CONFIGS.map((mkt) => (
              <button
                key={mkt.symbol}
                className={
                  "market-pill" +
                  (selectedMarket.symbol === mkt.symbol
                    ? " market-pill-active"
                    : "")
                }
                onClick={() => setSelectedMarket(mkt)}
              >
                {mkt.label}
              </button>
            ))}
          </div>
        </section>

        {/* Panel principal de la ronda */}
        <section className="bet-card">
          <div className="bet-card-header">
            <h2>{selectedMarket.question}</h2>
            <span className="bet-caption">
              Ronda actual:{" "}
              {currentRoundId != null ? `#${currentRoundId}` : "—"}
            </span>
          </div>

          <div className="round-status">
            <div className="round-status-left">
              <div className="round-status-line">
                <span>Estado ronda:</span>
                <strong>
                  {status === "betting"
                    ? "Ventana de apuestas abierta"
                    : status === "waiting"
                    ? "Esperando resolución"
                    : status === "resolved"
                    ? "Resuelta"
                    : "Sin ronda activa"}
                </strong>
              </div>
              <div className="round-status-line">
                <span>Tiempo:</span>
                <strong>{timeInfo || "—"}</strong>
              </div>
              <div className="round-status-line">
                <span>Fee por apuesta:</span>
                <strong>{feePct}</strong>
              </div>
            </div>
            <div className="round-status-right">
              <div className="round-status-line">
                <span>Precio inicio (feed):</span>
                <strong>
                  {startPrice != null ? `${startPrice.toFixed(2)} USD` : "—"}
                </strong>
              </div>
              <div className="round-status-line">
                <span>Precio final:</span>
                <strong>
                  {round && round.resolved && endPrice != null
                    ? `${endPrice.toFixed(2)} USD`
                    : "Pendiente"}
                </strong>
              </div>
            </div>
          </div>

          {/* Totales y wallets por lado */}
          <div className="bets-columns">
            <div className="bets-column yes-column">
              <div className="bets-column-header">
                <h3>YES</h3>
                <span>Total neto: {formatMck(totalYesNet)}</span>
              </div>
              <div className="bets-list">
                {betsYes.length === 0 && (
                  <p className="bets-empty">Todavía no hay apuestas YES.</p>
                )}
                {betsYes.map((b, idx) => (
                  <div key={idx} className="bet-row">
                    <span>{shortAddress(b.user)}</span>
                    <span>{b.gross.toFixed(2)} MCK</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bets-column no-column">
              <div className="bets-column-header">
                <h3>NO</h3>
                <span>Total neto: {formatMck(totalNoNet)}</span>
              </div>
              <div className="bets-list">
                {betsNo.length === 0 && (
                  <p className="bets-empty">Todavía no hay apuestas NO.</p>
                )}
                {betsNo.map((b, idx) => (
                  <div key={idx} className="bet-row">
                    <span>{shortAddress(b.user)}</span>
                    <span>{b.gross.toFixed(2)} MCK</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Controles de apuesta */}
          <div className="bet-controls">
            <div className="bet-amount">
              <label>
                Importe (MCK)
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                />
              </label>
              <span className="bet-hint">
                Se aplicará la fee indicada arriba sobre cada apuesta.
              </span>
            </div>
            <div className="bet-buttons">
              <button
                type="button"
                className="btn-yes"
                disabled={loading}
                onClick={() => placeBet(true)}
              >
                Apostar YES
              </button>
              <button
                type="button"
                className="btn-no"
                disabled={loading}
                onClick={() => placeBet(false)}
              >
                Apostar NO
              </button>
            </div>
          </div>

          {txStatus && <p className="tx-status">{txStatus}</p>}
        </section>
      </main>
    </div>
  );
}

export default BettingPage;

