// hardhat.config.js
require("@nomicfoundation/hardhat-toolbox");

const MNEMONIC =
  "test test test test test test test test test test test junk"; // o el que quieras usar

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.24",
  networks: {
    hardhat: {
      chainId: 31337,
      accounts: {
        mnemonic: MNEMONIC,
        count: 31, // 1 owner + 20 players + 10 reservadas
      },
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
  },
};

