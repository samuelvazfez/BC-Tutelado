# dApp de Apuestas – Guía de Arranque

Esta guía explica paso a paso cómo levantar el **backend** (Hardhat + Oracle + IPFS) y el **frontend** de la dApp de apuestas basada en smart contracts desplegados desde Remix/Hardhat.

---

## 📦 Requisitos previos

Asegúrate de tener instalado:

- Node.js y `npm`
- Docker (para IPFS)
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
```

> Nos situamos en la carpeta del proyecto de backend (Hardhat + oracle) para ejecutar el resto de comandos.

---

### 1.2. Arrancar la blockchain local de Hardhat

En una terminal:

```bash
npx hardhat node
```

> Levanta un nodo local de Hardhat que actuará como blockchain de desarrollo para desplegar los smart contracts.

> 🔁 **Recomendado:** deja esta terminal abierta mientras uses la dApp.

---

### 1.3. Arrancar IPFS en Docker

En **otra** terminal, dentro de `tutelado-bc/hardhat/bethouse-oracle`:

#### Opción A – Si el contenedor `ipfs_host` ya existe

```bash
docker start ipfs_host
```

> Inicia el contenedor IPFS existente llamado `ipfs_host` sin crear uno nuevo.

#### Opción B – Crear el contenedor `ipfs_host` (solo la primera vez)

```bash
docker run -d --name ipfs_host   -v "$PWD":/export   -v "$PWD":/data/ipfs   -p 4001:4001   -p 4001:4001/udp   -p 127.0.0.1:8080:8080   -p 127.0.0.1:5001:5001   ipfs/kubo
```

> Crea y levanta en segundo plano un contenedor IPFS llamado `ipfs_host`, mapeando volúmenes y puertos necesarios para usarlo desde la dApp.

---

### 1.4. Configurar CORS en IPFS

```bash
docker exec ipfs_host ipfs config --json API.HTTPHeaders.Access-Control-Allow-Origin '["http://0.0.0.0:5001", "http://localhost:3000", "http://127.0.0.1:5001", "https://webui.ipfs.io"]'
```

> Configura la instancia de IPFS dentro del contenedor para permitir peticiones desde el frontend y las URLs indicadas.

---

### 1.5. Desplegar y configurar los Smart Contracts

Asegúrate de seguir en:

```bash
cd tutelado-bc/hardhat/bethouse-oracle
```

#### 1.5.1. Deploy principal y configuración inicial

```bash
npx hardhat run scripts/deployAndSetup.js --network localhost
```

> Despliega los contratos principales en la red local de Hardhat y realiza la configuración inicial (roles, direcciones, etc.).

---

#### 1.5.2. Deploy del contrato `IpfsStorage`

```bash
npx hardhat run scripts/deployIpfsStorage.js --network localhost
```

> Despliega el contrato `IpfsStorage` en la red local y muestra la dirección que usará el frontend para guardar/leer hashes IPFS.

> ✏️ **Importante:** apúntate la dirección del contrato `IpfsStorage` que se muestra en la consola, la necesitarás en el paso 2.1.

---

#### 1.5.3. Instalar pdfkit para que el bot pueda crear el pdf para ipfs y subirlo

```bash
npm install pdfkit chartjs-node-canvas chart.js
```
> instalar lo necesario para el pdf que guardaremos en el ipfs. Solo necesario que lo hagamos una vez

---

#### 1.5.4. Arrancar el bot/oracle de reports

```bash
npx hardhat run scripts/oracleBotReports.js --network localhost
```

> Ejecuta el bot/oracle que se encarga de reportar resultados o datos on-chain necesarios para el sistema de apuestas.

---

> ✅ En este punto, el **backend** está levantado:  
> Hardhat node + contratos desplegados + IPFS + oracle.

---

## 2. Configurar y Arrancar el Frontend

### 2.1. Configurar la dirección de `IpfsStorage` en el frontend

Edita el fichero del contrato en el frontend:

```text
tutelado-bc/dapp_ipfs/src/contracts/src/
```

> Abre el archivo correspondiente a `IpfsStorage` y pega la dirección desplegada en el paso 1.5.2 para que la dApp interactúe con ese contrato.

*(Paso manual, no es un comando de terminal.)*

---

### 2.2. Ir a la carpeta del frontend

```bash
cd tutelado-bc/dapp_ipfs/src
```

> Cambiamos al directorio del frontend donde está la aplicación (por ejemplo, React) que actúa como interfaz de la dApp.

---

### 2.3. Arrancar la aplicación frontend

```bash
npm start
```

> Inicia el servidor de desarrollo del frontend (normalmente en `http://localhost:3000`) para poder interactuar con la dApp desde el navegador.

---

## 3. Resumen rápido de comandos

Por si quieres tenerlo compacto:

```bash
# Backend
cd tutelado-bc/hardhat/bethouse-oracle
npx hardhat node
docker start ipfs_host              # o docker run ... (si no existe)
docker exec ipfs_host ipfs config --json API.HTTPHeaders.Access-Control-Allow-Origin '[...]'
npx hardhat run scripts/deployAndSetup.js --network localhost
npx hardhat run scripts/deployIpfsStorage.js --network localhost
npx hardhat run scripts/oracleBotReports.js --network localhost

# Frontend
# (Editar dirección de IpfsStorage en tutelado-bc/dapp_ipfs/src/contracts/src/)
cd tutelado-bc/dapp_ipfs/src
npm start
```

> Con estos pasos deberías tener la dApp completa (backend + frontend) funcionando en local.
