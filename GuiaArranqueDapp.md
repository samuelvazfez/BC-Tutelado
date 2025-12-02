# dApp de Apuestas – Guía de Arranque

Esta guía explica paso a paso cómo levantar el **backend** (Hardhat + Oracle + IPFS) y el **frontend** de la dApp de apuestas basada en smart contracts desplegados desde Remix/Hardhat.

---

## 📦 Requisitos previos

Asegúrate de tener instalado:

- [Node.js](https://nodejs.org/) y `npm`
- [Docker](https://www.docker.com/) (para IPFS)
- `npx` (incluido con Node.js)
- Entorno de desarrollo para Hardhat (dependencias ya instaladas en el proyecto)

Estructura relevante del proyecto:

- Backend (Hardhat + oracle):  
  `tutelado-bc/hardhat/bethouse-oracle`
- Frontend (dApp + IPFS):  
  `tutelado-bc/dapp_ipfs/src`

---

## 1. Levantar el Backend (Hardhat + Oracle + IPFS)

### 1.1. Ir al directorio del backend

**Ruta:**

```bash
cd tutelado-bc/hardhat/bethouse-oracle
