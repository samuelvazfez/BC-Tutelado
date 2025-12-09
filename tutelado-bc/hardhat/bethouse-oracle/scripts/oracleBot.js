// scripts/oracleBot.js

const hre = require("hardhat");
const { ethers } = hre;
const readline = require("readline");

const PDFDocument = require("pdfkit");
const { ChartJSNodeCanvas } = require("chartjs-node-canvas");

// Config para la gráfica PNG
const chartWidth = 800;
const chartHeight = 400;
const chartJSNodeCanvas = new ChartJSNodeCanvas({
  width: chartWidth,
  height: chartHeight,
  backgroundColour: "white",
});


BigInt.prototype.toJSON = function () {
  return this.toString();
};


async function getKuboClient() {
  const { create } = await import("kubo-rpc-client");
  return create("/ip4/127.0.0.1/tcp/5001");
}

const ROUND_SECONDS = 300;
const BET_WINDOW_SECONDS = 90;
const NUM_ROUNDS = 100;
const HEARTBEAT_EVERY_MS = 1_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ===== tiempo ON-CHAIN =====

async function getChainTime() {
  const block = await ethers.provider.getBlock("latest");
  return Number(block.timestamp);
}

// ===== simulación de precio USD =====

let simulatedPriceUsd = 50_000;

function nextSimulatedPriceUsd() {
  const delta = Math.floor((Math.random() - 0.5) * 2000); // +/- ~1000 USD
  simulatedPriceUsd = Math.max(1_000, simulatedPriceUsd + delta);
  console.log(`  [FAKE] Simulated price: ${simulatedPriceUsd} USD`);
  return simulatedPriceUsd;
}

// ===== mover la blockchain con MCK =====

async function heartbeatTx(players, collateral) {
  const fromIndex = Math.floor(Math.random() * players.length);
  let toIndex = Math.floor(Math.random() * players.length);
  if (toIndex === fromIndex) toIndex = (toIndex + 1) % players.length;

  const from = players[fromIndex];
  const to = players[toIndex];
  const amount = ethers.parseEther("1");

  try {
    const tx = await collateral.connect(from).transfer(to.address, amount);
    await tx.wait();
    console.log(
      `  [HB] Transfer 1 MCK ${from.address.slice(0, 8)} -> ${to.address.slice(
        0,
        8
      )}`
    );
  } catch (e) {
    console.log("  [HB] Heartbeat fallido (se ignora):", e.message);
  }
}

// ======================================================
//  Lógica de ronda + generación de reporte JSON
// ======================================================

// Genera un PDF de recibo de ronda a partir del reporte
async function generateRoundReceiptPdf(report) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", (err) => reject(err));

    
    doc
      .fontSize(22)
      .text("BetHouse - Recibo de Ronda", { align: "center" });
    doc.moveDown(1.5);

    
    doc
      .fontSize(12)
      .text(`Ronda: ${report.roundId}`, { continued: true })
      .text(`    Mercado: BTC/USD`);
    doc.text(`Oracle:   ${report.oracleAddress}`);
    doc.text(`BetHouse: ${report.betHouseAddress}`);
    doc.text(`Storage:  ${report.storageAddress}`);
    doc.moveDown();

    
    doc.fontSize(12).text("Tiempos de la ronda", { underline: true });
    doc.moveDown(0.5);
    doc.text(
      `Inicio:   ${new Date(report.startTime * 1000).toLocaleString()}`
    );
    doc.text(
      `Fin:      ${new Date(report.endTime * 1000).toLocaleString()}`
    );
    doc.text(
      `Resuelta: ${new Date(report.resolvedAt * 1000).toLocaleString()}`
    );
    doc.moveDown();

    
    doc.fontSize(12).text("Resumen de precios (feed)", { underline: true });
    doc.moveDown(0.5);
    doc.text(`Precio inicio (raw): ${report.priceStartFeedRaw}`);
    doc.text(`Precio final  (raw): ${report.priceEndFeedRaw}`);
    doc.text(
      `Precio inicio (sim): ${report.priceStartUsdSim} USD`
    );
    doc.text(
      `Precio final  (sim): ${report.priceEndUsdSim} USD`
    );
    doc.moveDown();

    
    doc.fontSize(12).text("Resultado de la ronda", { underline: true });
    doc.moveDown(0.5);

    let outcomeText = "Ronda en modo REFUND.";
    if (!report.refundMode) {
      outcomeText = report.outcomeYes
        ? "Ganadores: lado YES (precio final > precio inicial)"
        : "Ganadores: lado NO (precio final <= precio inicial)";
    }
    doc.text(outcomeText);
    doc.moveDown(0.5);

    doc.text(
      `Total YES neto: ${report.totals.totalYesNet} MCK`
    );
    doc.text(
      `Total NO neto:  ${report.totals.totalNoNet} MCK`
    );
    doc.text(
      `Fees acumuladas: ${report.totals.feeAccrued} MCK`
    );
    doc.moveDown();

    
    doc
      .fontSize(10)
      .fillColor("gray")
      .text(
        "Nota: este recibo es un artefacto off-chain generado por el oráculo " +
          "a partir de los datos on-chain de la ronda. La fuente de verdad " +
          "sigue siendo la blockchain (eventos RoundResolved).",
        { align: "justify" }
      );

    doc.end();
  });
}

// Genera un PNG con una grafica simple precio inicio / precio fin
async function generateRoundChartPng(report) {
  const feedDecimals = report.feedDecimals ?? 8;
  const startPrice = Number(report.priceStartFeedRaw) / 10 ** feedDecimals;
  const endPrice = Number(report.priceEndFeedRaw) / 10 ** feedDecimals;

  const labels = ["Inicio", "Fin"];
  const data = [startPrice, endPrice];

  const configuration = {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Precio BTC/USD (feed)",
          data,
          borderWidth: 3,
          pointRadius: 5,
          pointHoverRadius: 7,
          tension: 0.2, 
          fill: false,
        },
      ],
    },
    options: {
      responsive: false,
      plugins: {
        title: {
          display: true,
          text: `Ronda ${report.roundId} - Precio inicio / fin`,
        },
        legend: {
          display: true,
        },
        tooltip: {
          callbacks: {
            label: function (ctx) {
              const v = ctx.parsed.y;
              return ` ${v.toFixed(2)} USD`;
            },
          },
        },
      },
      scales: {
        x: {
          title: {
            display: true,
            text: "Momento",
          },
        },
        y: {
          title: {
            display: true,
            text: "Precio BTC/USD",
          },
          beginAtZero: false,
        },
      },
    },
  };

  const imageBuffer = await chartJSNodeCanvas.renderToBuffer(configuration);
  return imageBuffer;
}


async function runRound(
  roundIdx,
  owner,
  players,
  betHouse,
  collateral,
  storage,
  ipfsClient,
  marketId,
  feed,
  feedDecimals
) {
  console.log(`\n=== RONDA ${roundIdx} (tiempo real, on-chain) ===`);

  const SCALE = 10n ** BigInt(feedDecimals);

  // 1) fijar precio inicial en el Mock y arrancar ronda
  const priceStartUsd = nextSimulatedPriceUsd();
  const priceStartFeed = BigInt(priceStartUsd) * SCALE;

  const txUpdateStart = await feed.updateAnswer(priceStartFeed);
  await txUpdateStart.wait();

  const txStart = await betHouse.connect(owner).startRound(marketId);
  await txStart.wait();

  const currentRoundId = await betHouse.currentRoundId();
  const r0 = await betHouse.rounds(currentRoundId);

  const startTime = Number(r0.startTime);
  const endTime = Number(r0.endTime);

  console.log("Round id            :", currentRoundId.toString());
  console.log("marketId            :", marketId);
  console.log("startTime (on-chain):", startTime);
  console.log("endTime   (on-chain):", endTime);
  console.log("Precio inicio (USD) :", priceStartUsd);

  const amountYes = ethers.parseEther("10");
  const amountNo = ethers.parseEther("10");

  const yesPlayers = players.slice(0, 10);
  const noPlayers = players.slice(10);

  let yesIndex = 0;
  let noIndex = 0;

  const bets = [];
  const feeBps = await betHouse.FEE_BET_BPS();
  const FEE_DENOM = 10_000n;

  // 2) bucle hasta final de ronda
  while (true) {
    const nowSec = await getChainTime();
    const elapsed = nowSec - startTime;
    const remaining = endTime - nowSec;

    console.log(
      `\n[tick] chainNow=${nowSec} elapsed=${elapsed}s remaining=${remaining}s`
    );

    if (elapsed >= 0 && elapsed <= BET_WINDOW_SECONDS) {
      console.log("  Dentro de ventana de apuestas.");
      let betsThisTick = 0;

      // YES
      while (yesIndex < yesPlayers.length && betsThisTick < 3) {
        const p = yesPlayers[yesIndex++];
        const tx = await betHouse.connect(p).betYes(currentRoundId, amountYes);
        await tx.wait();

        const gross = amountYes;
        const fee = (gross * feeBps) / FEE_DENOM;
        const net = gross - fee;

        bets.push({
          address: p.address,
          side: "YES",
          gross: ethers.formatEther(gross),
          net: ethers.formatEther(net),
          txHash: tx.hash,
        });

        console.log(
          `  [BET] YES 10 MCK from ${p.address.slice(0, 8)} (idx=${yesIndex})`
        );
        betsThisTick++;
      }

      // NO
      while (noIndex < noPlayers.length && betsThisTick < 6) {
        const p = noPlayers[noIndex++];
        const tx = await betHouse.connect(p).betNo(currentRoundId, amountNo);
        await tx.wait();

        const gross = amountNo;
        const fee = (gross * feeBps) / FEE_DENOM;
        const net = gross - fee;

        bets.push({
          address: p.address,
          side: "NO",
          gross: ethers.formatEther(gross),
          net: ethers.formatEther(net),
          txHash: tx.hash,
        });

        console.log(
          `  [BET] NO  10 MCK from ${p.address.slice(0, 8)} (idx=${noIndex})`
        );
        betsThisTick++;
      }

      if (betsThisTick === 0) {
        console.log("  [BET] No quedan jugadores nuevos para apostar.");
      }
    } else {
      console.log("  Fuera de ventana de apuestas.");
    }

    if (nowSec >= endTime) {
      console.log(
        "  Hemos alcanzado endTime on-chain. Vamos a fijar precio final y resolver la ronda."
      );
      break;
    }

    await heartbeatTx(players, collateral);
    await sleep(HEARTBEAT_EVERY_MS);
  }

  // 3) Precio final: subida, bajada o empate (para probar refundMode)
  const scenarioRand = Math.random();
  let priceEndUsd = priceStartUsd;

  if (scenarioRand < 0.4) {
    priceEndUsd = priceStartUsd + 500; // sube
  } else if (scenarioRand < 0.8) {
    priceEndUsd = priceStartUsd - 500; // baja
  } else {
    priceEndUsd = priceStartUsd; // empate
  }

  const priceEndFeed = BigInt(priceEndUsd) * SCALE;

  const txUpdateEnd = await feed.updateAnswer(priceEndFeed);
  await txUpdateEnd.wait();

  console.log("Precio final (USD)  :", priceEndUsd);

  // 4) endRound (sin outcomeYes, lo calcula el contrato con los feeds)
  const txEnd = await betHouse.connect(owner).endRound(currentRoundId);
  await txEnd.wait();
  const resolvedAt = await getChainTime();

  console.log("Ronda cerrada on-chain.");

  const r = await betHouse.rounds(currentRoundId);
  console.log("  refundMode:", r.refundMode);
  console.log("  outcomeYes:", r.outcomeYes);
  console.log("  totalYesNet:", ethers.formatEther(r.totalYesNet));
  console.log("  totalNoNet :", ethers.formatEther(r.totalNoNet));

  const outcomeYes = r.outcomeYes;
  const refundMode = r.refundMode;

  const winnersSide = refundMode
    ? null
    : outcomeYes
    ? "YES"
    : "NO";

  const reportBets = bets.map((b) => ({
    ...b,
    winner:
      !refundMode &&
      ((b.side === "YES" && outcomeYes) ||
        (b.side === "NO" && !outcomeYes)),
  }));

  // 5) Construir reporte JSON

  const priceStartFeedRaw = r.priceStart.toString();
  const priceEndFeedRaw = r.priceEnd.toString();

  const report = {
    roundId: currentRoundId.toString(),
    marketId,
    feedAddress: await feed.getAddress(),
    feedDecimals,
    oracleAddress: owner.address,
    betHouseAddress: await betHouse.getAddress(),
    collateralAddress: await collateral.getAddress(),
    storageAddress: await storage.getAddress(),
    startTime,
    endTime,
    resolvedAt,
    roundSeconds: ROUND_SECONDS,
    betWindowSeconds: BET_WINDOW_SECONDS,
    // precios simulados en USD
    priceStartUsdSim: priceStartUsd,
    priceEndUsdSim: priceEndUsd,
    // valores crudos leídos on-chain
    priceStartFeedRaw,
    priceEndFeedRaw,
    outcomeYes,
    refundMode,
    totals: {
      totalYesNet: ethers.formatEther(r.totalYesNet),
      totalNoNet: ethers.formatEther(r.totalNoNet),
      feeAccrued: ethers.formatEther(r.feeAccrued),
    },
    bets: reportBets,
  };

  // 6) Serializar a JSON (protegiendo BigInt)
  const json = JSON.stringify(report, null, 2);
  console.log("  [IPFS] Subiendo reporte de ronda a IPFS...");

  const file = await ipfsClient.add({
    path: `round-${report.roundId}.json`,
    content: Buffer.from(json),
  });

  const cidStr = file.cid.toString();
  console.log("  [IPFS] CID JSON:", cidStr);

  // ===== Copiar a MFS =====
  try {
    const mfsDir = "/round-reports";
    const mfsPath = `${mfsDir}/round-${report.roundId}.json`;
    await ipfsClient.files.mkdir(mfsDir, { parents: true });

    try {
      await ipfsClient.files.rm(mfsPath);
      console.log("  [IPFS] Eliminado antiguo en MFS:", mfsPath);
    } catch (e) {
      if (!e.message.includes("does not exist")) {
        console.error("  [IPFS] Error al borrar en MFS:", e.message);
      }
    }

    await ipfsClient.files.cp(`/ipfs/${cidStr}`, mfsPath, { parents: true });
    console.log("  [IPFS] Copiado a MFS:", mfsPath);
  } catch (e) {
    console.error("  [IPFS] Error en MFS (se continúa igualmente):", e.message);
  }

  // ===== Guardar CID JSON en el contrato =====
  try {
    const txStore = await storage
      .connect(owner)
      .setRoundReport(currentRoundId, cidStr);
    await txStore.wait();
    console.log(
      `  [STORAGE] CID JSON guardado para ronda ${currentRoundId.toString()}`
    );
  } catch (e) {
    console.error("  [STORAGE] Error guardando roundReport:", e.message);
  }

  // ====== PDF de recibo ======
  try {
    console.log("  [PDF] Generando recibo de ronda...");
    const pdfBuffer = await generateRoundReceiptPdf(report);
    console.log("  [PDF] Buffer generado, tamaño:", pdfBuffer.length);
    const pdfResult = await ipfsClient.add({
      path: `round-${report.roundId}-receipt.pdf`,
      content: pdfBuffer,
    });
    const pdfCid = pdfResult.cid.toString();
    console.log("  [IPFS] PDF CID:", pdfCid);

    const txPdf = await storage
      .connect(owner)
      .setRoundReceipt(currentRoundId, pdfCid);
    await txPdf.wait();
    console.log(
      `  [STORAGE] CID PDF guardado para ronda ${currentRoundId.toString()}`
    );
  } catch (e) {
    console.error(
      "  [PDF/IPFS] Error generando o guardando el recibo - Detalles:",
      e.message
    );
    console.error("  [PDF/IPFS] Stack:", e.stack);
  }

  // ====== PNG con grafica de precios ======
  try {
    console.log("  [CHART] Generando grafica de ronda...");
    const pngBuffer = await generateRoundChartPng(report);
    console.log("  [CHART] Buffer generado, tamaño:", pngBuffer.length);

    const pngResult = await ipfsClient.add({
      path: `round-${report.roundId}-chart.png`,
      content: pngBuffer,
    });
    const pngCid = pngResult.cid.toString();
    console.log("  [IPFS] Chart PNG CID:", pngCid);

    const txChart = await storage
      .connect(owner)
      .setRoundChart(currentRoundId, pngCid);
    await txChart.wait();
    console.log(
      `  [STORAGE] CID CHART guardado para ronda ${currentRoundId.toString()}`
    );
  } catch (e) {
    console.error(
      "  [CHART/IPFS] Error generando o guardando la grafica - Detalles:",
      e.message
    );
    console.error("  [CHART/IPFS] Stack:", e.stack);
  }
}

// ======================================================
//  main
// ======================================================

async function main() {
  const [owner, ...others] = await ethers.getSigners();
  const players = others.slice(0, 20);

  let betHouseAddress = process.env.BET_HOUSE_ADDRESS;
  let collateralAddress = process.env.COLLATERAL_ADDRESS;
  let storageAddress = process.env.IPFS_STORAGE_ADDRESS;

  if (!betHouseAddress) {
    betHouseAddress = await ask("Introduce la dirección de BetHouse: ");
  }
  if (!collateralAddress) {
    collateralAddress = await ask("Introduce la dirección de CollateralMock: ");
  }
  if (!storageAddress) {
    storageAddress = await ask(
      "Introduce la dirección de IpfsRoundStorage: "
    );
  }

  if (
    !ethers.isAddress(betHouseAddress) ||
    !ethers.isAddress(collateralAddress) ||
    !ethers.isAddress(storageAddress)
  ) {
    throw new Error("Alguna de las direcciones introducidas no es válida");
  }

  const betHouse = await ethers.getContractAt("BetHouse", betHouseAddress);
  const collateral = await ethers.getContractAt(
    "CollateralMock",
    collateralAddress
  );
  const storage = await ethers.getContractAt(
    "IpfsRoundStorage",
    storageAddress
  );

  // Recuperar el feed del mercado
  const MARKET_BTC_USD = ethers.id("BTC/USD");
  const marketInfo = await betHouse.getMarket(MARKET_BTC_USD);
  const feedAddress = marketInfo[0];
  const enabled = marketInfo[1];

  if (!enabled) {
    throw new Error("El mercado BTC/USD no está habilitado en BetHouse");
  }

  const feed = await ethers.getContractAt("MockV3Aggregator", feedAddress);
  const feedDecimalsRaw = await feed.decimals();
  const feedDecimals = Number(feedDecimalsRaw);

  const ipfsClient = await getKuboClient();

  console.log("\n=== CONFIG ORACLE+IPFS+STORAGE ===");
  console.log("Owner (oracle)   :", owner.address);
  console.log("BetHouse         :", await betHouse.getAddress());
  console.log("Collateral       :", await collateral.getAddress());
  console.log("IpfsStorage      :", await storage.getAddress());
  console.log("Market BTC/USD id:", MARKET_BTC_USD);
  console.log("Feed BTC/USD     :", feedAddress);
  console.log("Feed decimals    :", feedDecimals);
  console.log("==========================================\n");

  for (let i = 1; i <= NUM_ROUNDS; i++) {
    await runRound(
      i,
      owner,
      players,
      betHouse,
      collateral,
      storage,
      ipfsClient,
      MARKET_BTC_USD,
      feed,
      feedDecimals
    );
  }

  console.log(
    "\nTodas las rondas simuladas, reportes subidos a IPFS, copiados a MFS y CIDs guardados en IpfsRoundStorage."
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
