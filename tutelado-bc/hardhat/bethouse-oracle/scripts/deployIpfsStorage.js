// scripts/deployIpfsStorage.js
const hre = require("hardhat");

async function main() {
  const { ethers } = hre;

  // Usamos la primera cuenta (owner) como owner del contrato 
  const [owner] = await ethers.getSigners();

  console.log("Owner (IpfsRoundStorage):", owner.address);

  // Factory del contrato
  const IpfsRoundStorage = await ethers.getContractFactory("IpfsRoundStorage");

  // El constructor de IpfsRoundStorage recibe el owner inicial
  const storage = await IpfsRoundStorage.deploy(owner.address);
  await storage.waitForDeployment();

  const addr = await storage.getAddress();
  console.log("IpfsRoundStorage deployed to:", addr);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

