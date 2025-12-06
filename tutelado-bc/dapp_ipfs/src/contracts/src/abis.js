// src/contracts/src/abis.js

import BetHouseArtifact from "./abis/BetHouse.json";
import CollateralArtifact from "./abis/CollateralMock.json";
import IpfsArtifact from "./abis/IpfsStorage.json";

const abis = {
  betHouse: BetHouseArtifact.abi,
  collateral: CollateralArtifact.abi,
  ipfs: IpfsArtifact.abi,
};

export default abis;

