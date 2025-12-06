import React, { useEffect, useState } from "react";
import "./App.css";

import logo from "./ethereumLogo.png";

import { ethers } from "ethers";
import { addresses, abis } from "./contracts";

// *** CONFIG ***
const MAX_ROUNDS_TO_SCAN = 20;

const rpcUrl = "http://127.0.0.1:8545";
const defaultProvider = new ethers.providers.JsonRpcProvider(rpcUrl);

// Contrato IpfsRoundStorage conectado al nodo local
const ipfsContract = new ethers.Contract(
  addresses.ipfs,
  abis.ipfs,
  defaultProvider
);

// Lee el CID de una ronda concreta desde IpfsRoundStorage
async function readRoundCid(roundId) {
  if (!roundId) return "";
  try {
    const result = await ipfsContract.roundReports(roundId);
    return result;
  } catch (e) {
    console.error("Error leyendo roundReport:", e);
    return "";
  }
}

// Lee el CID del PDF de recibo
async function readRoundReceiptCid(roundId) {
  if (!roundId) return "";
  try {
    const result = await ipfsContract.roundReceiptCid(roundId);
    return result;
  } catch (e) {
    console.error("Error leyendo roundReceiptCid:", e);
    return "";
  }
}

// Lee el CID de la grafica PNG
async function readRoundChartCid(roundId) {
  if (!roundId) return "";
  try {
    const result = await ipfsContract.roundChartCid(roundId);
    return result;
  } catch (e) {
    console.error("Error leyendo roundChartCid:", e);
    return "";
  }
}


// Descarga y parsea el JSON de IPFS vía gateway local
async function fetchReportFromIpfs(cid) {
  const url = `http://127.0.0.1:8080/ipfs/${cid}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Error HTTP ${resp.status} al leer ${url}`);
  }
  const data = await resp.json();
  return data;
}

function formatEth(valueStr) {
  const n = parseFloat(valueStr);
  if (Number.isNaN(n)) return "-";
  return n.toFixed(2) + " MCK";
}

function formatUsd(value) {
  if (value === undefined || value === null) return "-";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }) + " USD";
}

function shortAddress(addr) {
  if (!addr || addr.length < 10) return addr || "-";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatTimestamp(ts) {
  if (!ts) return "-";
  const d = new Date(ts * 1000);
  return d.toLocaleString();
}

function RoundExplorer() {
  const [roundSummaries, setRoundSummaries] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState("");

  const [roundInput, setRoundInput] = useState("");
  const [selectedReport, setSelectedReport] = useState(null);
  const [selectedCid, setSelectedCid] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [showRawJson, setShowRawJson] = useState(false);
  const [selectedPdfCid, setSelectedPdfCid] = useState("");
  const [selectedChartCid, setSelectedChartCid] = useState("");
  const [showArtifacts, setShowArtifacts] = useState(false);


  // Pedir cuentas a MetaMask al montar
  useEffect(() => {
    if (window.ethereum) {
      window.ethereum.request({ method: "eth_requestAccounts" });
    }
  }, []);

useEffect(() => {
  async function loadHistory() {
    console.log("=== [HISTORY] Iniciando carga de histórico ===");
    console.log("[HISTORY] MAX_ROUNDS_TO_SCAN =", MAX_ROUNDS_TO_SCAN);
    console.log("[HISTORY] IpfsRoundStorage address =", addresses.ipfs);

    setLoadingHistory(true);
    setHistoryError("");

    try {
      const summaries = [];

      for (let id = 1; id <= MAX_ROUNDS_TO_SCAN; id++) {
        console.log("\n[HISTORY] --- Ronda", id, "---");
                let cid;
        try {
          cid = await readRoundCid(id);
          console.log("[HISTORY] CID JSON on-chain =", cid);
        } catch (e) {
          console.error("[HISTORY] Error leyendo roundReports(", id, "):", e);
          continue;
        }

        if (!cid || cid.length === 0) {
          console.log("[HISTORY] Sin CID JSON para esta ronda, se salta.");
          continue;
        }

        // leemos también CIDs de PDF y gráfica
        const pdfCid = await readRoundReceiptCid(id);
        const chartCid = await readRoundChartCid(id);
        console.log("[HISTORY] pdfCid =", pdfCid, "chartCid =", chartCid);

        try {
          const url = `http://127.0.0.1:8080/ipfs/${cid}`;
          console.log("[HISTORY] Fetch JSON desde:", url);

          const report = await fetchReportFromIpfs(cid);
          console.log("[HISTORY] JSON cargado. roundId en JSON =", report.roundId);

          const participants = Array.isArray(report.bets)
            ? report.bets.length
            : 0;

          let totalGross = 0;
          if (Array.isArray(report.bets)) {
            for (const b of report.bets) {
              const g = parseFloat(b.gross);
              if (!Number.isNaN(g)) totalGross += g;
            }
          }

          const fees = report.totals?.feeAccrued || "0";
          const refundMode = report.refundMode;
          const outcomeYes = report.outcomeYes;

          let outcomeLabel = "REFUND";
          if (!refundMode) {
            outcomeLabel = outcomeYes ? "YES" : "NO";
          }

          const summary = {
            roundId: parseInt(report.roundId || id, 10),
            cid,
            pdfCid,
            chartCid,
            participants,
            totalGross,
            fees,
            refundMode,
            outcomeYes,
            outcomeLabel,
          };

          console.log("[HISTORY] Summary construido:", summary);

          summaries.push(summary);
        } catch (inner) {
          console.warn(
            "[HISTORY] Error cargando/parsing JSON de ronda",
            id,
            inner
          );
        }
      }

      summaries.sort((a, b) => a.roundId - b.roundId);
      console.log("[HISTORY] Summaries finales:", summaries);
      setRoundSummaries(summaries);

      if (summaries.length === 0) {
        console.log("[HISTORY] No se encontró ninguna ronda con CID+JSON válido.");
      }
    } catch (err) {
      console.error("[HISTORY] Error general en loadHistory:", err);
      setHistoryError("No se pudo cargar el histórico de rondas.");
    } finally {
      setLoadingHistory(false);
      console.log("=== [HISTORY] Fin de carga de histórico ===");
    }
  }

  loadHistory();
}, []);


  // Cargar detalle de una ronda concreta
    async function loadRoundDetail(roundId) {
    setDetailLoading(true);
    setDetailError("");
    setShowRawJson(false);
    setShowArtifacts(false);
    try {
      const cid = await readRoundCid(roundId);
      const pdfCid = await readRoundReceiptCid(roundId);
      const chartCid = await readRoundChartCid(roundId);

      console.log("[DETAIL] pdfCid =", pdfCid, "chartCid =", chartCid);

      if (!cid || cid.length === 0) {
        setSelectedReport(null);
        setSelectedCid("");
        setSelectedPdfCid("");
        setSelectedChartCid("");
        setDetailError("No hay CID almacenado para esa ronda.");
        return;
      }

      const report = await fetchReportFromIpfs(cid);
      setSelectedReport(report);
      setSelectedCid(cid);
      setSelectedPdfCid(pdfCid && pdfCid.length > 0 ? pdfCid : "");
      setSelectedChartCid(chartCid && chartCid.length > 0 ? chartCid : "");
    } catch (err) {
      console.error("Error cargando detalle de ronda:", err);
      setSelectedReport(null);
      setSelectedCid("");
      setSelectedPdfCid("");
      setSelectedChartCid("");
      setDetailError("Error leyendo el JSON de IPFS.");
    } finally {
      setDetailLoading(false);
    }
  }


  const handleSearchRound = (e) => {
    e.preventDefault();
    if (!roundInput) return;
    const idNum = parseInt(roundInput, 10);
    if (Number.isNaN(idNum) || idNum <= 0) {
      setDetailError("Round ID no válido.");
      return;
    }
    loadRoundDetail(idNum);
  };

  const handleClickSummaryCard = (summary) => {
    setRoundInput(summary.roundId.toString());
    loadRoundDetail(summary.roundId);
  };

  return (
    <div className="App">
      <header className="app-header">
        <div className="app-header-top">
          <img src={logo} className="app-logo" alt="logo" />
          <div>
            <h1>BetHouse Round Explorer</h1>
            <p className="app-subtitle">
              Visualiza los reportes de rondas almacenados en IPFS y referenciados on-chain
              a través de <code>IpfsRoundStorage</code>.
            </p>
          </div>
        </div>
      </header>

      <main className="app-main">
        {/* HISTÓRICO DE RONDAS */}
        <section className="card">
          <div className="card-header">
            <h2>Histórico de rondas</h2>
            <span className="card-caption">
              Resumen rápido de las rondas registradas (hasta {MAX_ROUNDS_TO_SCAN}).
            </span>
          </div>

          {loadingHistory && <p>Cargando histórico de rondas...</p>}
          {historyError && <p className="error">{historyError}</p>}

          {!loadingHistory && !historyError && roundSummaries.length === 0 && (
            <p>No se han encontrado rondas con reportes en IPFS.</p>
          )}

          {!loadingHistory && roundSummaries.length > 0 && (
            <div className="rounds-strip">
              {roundSummaries.map((r) => (
                <button
                  key={r.roundId}
                  className="round-card"
                  onClick={() => handleClickSummaryCard(r)}
                >
                  <div className="round-card-header">
                    <span className="round-id">Ronda #{r.roundId}</span>
                    <span
                      className={
                        "badge " +
                        (r.refundMode
                          ? "badge-refund"
                          : r.outcomeYes
                          ? "badge-yes"
                          : "badge-no")
                      }
                    >
                      {r.refundMode ? "REFUND" : r.outcomeYes ? "YES" : "NO"}
                    </span>
                  </div>
                  <div className="round-card-body">
                    <div className="round-card-row">
                      <span>Participantes</span>
                      <strong>{r.participants}</strong>
                    </div>
                    <div className="round-card-row">
                      <span>Total apostado</span>
                      <strong>{r.totalGross.toFixed(2)} MCK</strong>
                    </div>
                    <div className="round-card-row">
                      <span>Fees</span>
                      <strong>{formatEth(r.fees)}</strong>
                    </div>
                    <div className="round-card-cid">
                      CID:
                      <span>{r.cid.slice(0, 10)}...</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* DETALLE DE RONDA */}
        <section className="card">
          <div className="card-header">
            <h2>Detalle de ronda</h2>
            <span className="card-caption">
              Introduce un número de ronda o selecciona una tarjeta de arriba.
            </span>
          </div>

          <form className="round-search" onSubmit={handleSearchRound}>
            <label>
              Round ID
              <input
                type="number"
                min="1"
                step="1"
                value={roundInput}
                onChange={(e) => setRoundInput(e.target.value)}
                placeholder="Ej: 3"
              />
            </label>
            <button type="submit" className="btn-primary">
              Ver ronda
            </button>
          </form>

          {detailLoading && <p>Cargando detalle...</p>}
          {detailError && <p className="error">{detailError}</p>}

          {!detailLoading && !detailError && selectedReport && (
            <>
              <div className="round-detail-header">
                <div>
                  <h3>Ronda #{selectedReport.roundId}</h3>
                  <p className="round-detail-market">
                    Mercado:&nbsp;
                    <code>{selectedReport.marketId}</code>
                  </p>
                  <p className="round-detail-outcome">
                    Resultado:&nbsp;
                    {selectedReport.refundMode ? (
                      <span className="badge badge-refund">
                        REFUND (sin ganador)
                      </span>
                    ) : selectedReport.outcomeYes ? (
                      <span className="badge badge-yes">
                        YES (precio sube)
                      </span>
                    ) : (
                      <span className="badge badge-no">
                        NO (precio baja)
                      </span>
                    )}
                  </p>
                </div>
                <div className="round-detail-meta">
                  <div>
                    <span>Precio inicio (sim)</span>
                    <strong>
                      {formatUsd(selectedReport.priceStartUsdSim)}
                    </strong>
                  </div>
                  <div>
                    <span>Precio final (sim)</span>
                    <strong>{formatUsd(selectedReport.priceEndUsdSim)}</strong>
                  </div>
                  <div>
                    <span>Duración ronda</span>
                    <strong>{selectedReport.roundSeconds}s</strong>
                  </div>
                  <div>
                    <span>Ventana de apuestas</span>
                    <strong>{selectedReport.betWindowSeconds}s</strong>
                  </div>
                </div>
              </div>

              <div className="round-detail-grid">
                <div className="round-detail-card">
                  <h4>Tiempos on-chain</h4>
                  <ul className="detail-list">
                    <li>
                      <span>Inicio:</span>
                      <strong>{formatTimestamp(selectedReport.startTime)}</strong>
                    </li>
                    <li>
                      <span>Fin previsto:</span>
                      <strong>{formatTimestamp(selectedReport.endTime)}</strong>
                    </li>
                    <li>
                      <span>Resuelta en:</span>
                      <strong>{formatTimestamp(selectedReport.resolvedAt)}</strong>
                    </li>
                  </ul>
                </div>

                <div className="round-detail-card">
                  <h4>Direcciones</h4>
                  <ul className="detail-list">
                    <li>
                      <span>Oráculo:</span>
                      <strong>{shortAddress(selectedReport.oracleAddress)}</strong>
                    </li>
                    <li>
                      <span>BetHouse:</span>
                      <strong>{shortAddress(selectedReport.betHouseAddress)}</strong>
                    </li>
                    <li>
                      <span>Collateral:</span>
                      <strong>
                        {shortAddress(selectedReport.collateralAddress)}
                      </strong>
                    </li>
                    <li>
                      <span>Feed:</span>
                      <strong>{shortAddress(selectedReport.feedAddress)}</strong>
                    </li>
                  </ul>
                </div>

                <div className="round-detail-card totals-card">
                  <h4>Totales</h4>
                  <ul className="detail-list">
                    <li>
                      <span>Total YES neto:</span>
                      <strong>
                        {formatEth(selectedReport.totals.totalYesNet)}
                      </strong>
                    </li>
                    <li>
                      <span>Total NO neto:</span>
                      <strong>
                        {formatEth(selectedReport.totals.totalNoNet)}
                      </strong>
                    </li>
                    <li>
                      <span>Fees acumuladas:</span>
                      <strong>
                        {formatEth(selectedReport.totals.feeAccrued)}
                      </strong>
                    </li>
                    <li>
                      <span>Participantes:</span>
                      <strong>
                        {Array.isArray(selectedReport.bets)
                          ? selectedReport.bets.length
                          : 0}
                      </strong>
                    </li>
                  </ul>
                </div>
              </div>

              <div className="round-bets-card">
                <div className="round-bets-header">
                  <h4>Apuestas</h4>
                  <span className="card-caption">
                    Detalle de todas las apuestas individuales (YES/NO, neto, ganador).
                  </span>
                </div>
                <div className="bets-table-wrapper">
                  <table className="bets-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Address</th>
                        <th>Lado</th>
                        <th>Gross</th>
                        <th>Net</th>
                        <th>Ganador</th>
                        <th>Tx</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedReport.bets.map((b, idx) => (
                        <tr key={idx}>
                          <td>{idx + 1}</td>
                          <td>{shortAddress(b.address)}</td>
                          <td>{b.side}</td>
                          <td>{b.gross}</td>
                          <td>{b.net}</td>
                          <td>
                            {b.winner ? (
                              <span className="badge badge-yes">WIN</span>
                            ) : (
                              <span className="badge badge-no">LOSE</span>
                            )}
                          </td>
                          <td className="tx-hash-cell">
                            <a
                              href={`https://sepolia.etherscan.io/tx/${b.txHash}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {b.txHash.slice(0, 10)}...
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* JSON bruto */}
              <div className="json-toggle">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowRawJson((prev) => !prev)}
                >
                  {showRawJson ? "Ocultar JSON bruto" : "Ver JSON bruto"}
                </button>
                {selectedCid && (
                  <a
                    className="btn-link"
                    href={`http://127.0.0.1:8080/ipfs/${selectedCid}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Abrir en gateway IPFS
                  </a>
                )}
              </div>
              <div className="round-artifacts-links">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowArtifacts((prev) => !prev)}
                  disabled={!selectedPdfCid || !selectedChartCid}
                >
                  {showArtifacts ? "Ocultar pdf y png" : "Mostrar pdf y png"}
                </button>
                {!selectedPdfCid || !selectedChartCid && (
                  <p style={{ color: "#999", fontSize: "0.9em" }}>
                    No hay PDF o gráfica disponibles para esta ronda
                  </p>
                )}
                {showArtifacts && (
                  <>
                    {selectedPdfCid && (
                      <a
                        className="btn-link"
                        href={`http://127.0.0.1:8080/ipfs/${selectedPdfCid}?download=true`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Descargar recibo PDF
                      </a>
                    )}
                    {selectedChartCid && (
                      <a
                        className="btn-link"
                        href={`http://127.0.0.1:8080/ipfs/${selectedChartCid}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Ver gráfica de precios
                      </a>
                    )}
                  </>
                )}
              </div>


              {showRawJson && (
                <pre className="json-viewer">
                  {JSON.stringify(selectedReport, null, 2)}
                </pre>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}

export default RoundExplorer;

