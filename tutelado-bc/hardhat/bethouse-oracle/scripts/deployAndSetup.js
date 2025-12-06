// scripts/deployAndSetup.js
const hre = require("hardhat");

async function main() {
  const { ethers } = hre;

  const [owner, ...others] = await ethers.getSigners();

  
  const players = others.slice(0, 20);


  const reserved = others.slice(20, 30);

  console.log("Owner:", owner.address);
  console.log("\nPlayers (cuentas que apuestan / heartbeat):");
  players.forEach((p, i) => console.log(`  [P${i}] ${p.address}`));

  console.log("\nReservadas (para importar en MetaMask, no usadas por scripts):");
  reserved.forEach((p, i) => console.log(`  [R${i}] ${p.address}`));

  // 1) Deploy CollateralMock
  const CollateralMock = await ethers.getContractFactory("CollateralMock");
  const collateral = await CollateralMock.deploy(
    "Mock Collateral",
    "MCK",
    18,
    owner.address
  );
  await collateral.waitForDeployment();
  const collateralAddress = await collateral.getAddress();
  console.log("\nCollateralMock deployed to:", collateralAddress);

  // 2) Deploy MockV3Aggregator para BTC/USD
  const MockV3Aggregator = await ethers.getContractFactory("MockV3Aggregator");
  const DECIMALS = 8;
  const INITIAL_PRICE_USD = 50_000n; 
  const SCALE = 10n ** BigInt(DECIMALS);

  const btcFeed = await MockV3Aggregator.deploy(
    DECIMALS,
    INITIAL_PRICE_USD * SCALE
  );
  await btcFeed.waitForDeployment();
  const btcFeedAddress = await btcFeed.getAddress();
  console.log("MockV3Aggregator (BTC/USD) deployed to:", btcFeedAddress);

  // 3) Deploy BetHouse
  const BetHouse = await ethers.getContractFactory("BetHouse");
  const betHouse = await BetHouse.deploy(collateralAddress, owner.address);
  await betHouse.waitForDeployment();
  const betHouseAddress = await betHouse.getAddress();
  console.log("BetHouse deployed to:", betHouseAddress);

  // 4) Registrar mercado BTC/USD en BetHouse
  const MARKET_BTC_USD = ethers.id("BTC/USD");
  const txMarket = await betHouse.addMarket(MARKET_BTC_USD, btcFeedAddress);
  await txMarket.wait();
  console.log("Market BTC/USD registrado en BetHouse.");

  // 5) Mint colateral + approve para cada player
  const initialBalance = ethers.parseEther("100000"); // 100000 MCK

  for (const p of players) {
    const txMint = await collateral.mint(p.address, initialBalance);
    await txMint.wait();

    const txApprove = await collateral
      .connect(p)
      .approve(betHouseAddress, initialBalance);
    await txApprove.wait();

    console.log(`Player ${p.address} listo (mint + approve)`);
  }

  console.log("\nDeploy + setup completo.");
  console.log("  Collateral   :", collateralAddress);
  console.log("  BetHouse     :", betHouseAddress);
  console.log("  BTC/USD feed :", btcFeedAddress);
  console.log("  MARKET_ID    :", MARKET_BTC_USD);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

