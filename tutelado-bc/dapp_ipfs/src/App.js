// src/App.js
import React, { useState } from "react";
import BettingPage from "./BettingPage";
import RoundExplorer from "./RoundExplorer";

function App() {
  const [activeTab, setActiveTab] = useState("betting");

  const rootStyle = {
    minHeight: "100vh",
    backgroundColor: "#020617",
    color: "#e5e7eb",
    fontFamily:
      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  };

  const headerStyle = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "0.8rem 1.2rem",
    borderBottom: "1px solid rgba(148, 163, 184, 0.3)",
  };

  const titleStyle = {
    margin: 0,
    fontSize: "1.1rem",
  };

  const tabsStyle = {
    display: "flex",
    gap: "0.4rem",
  };

  const tabBtn = (active) => ({
    padding: "0.35rem 0.9rem",
    borderRadius: "999px",
    border: active
      ? "1px solid #38bdf8"
      : "1px solid rgba(148, 163, 184, 0.6)",
    background: active ? "#0f172a" : "transparent",
    color: "#e5e7eb",
    fontSize: "0.85rem",
    cursor: "pointer",
  });

  const mainStyle = {
    minHeight: "calc(100vh - 56px)",
  };

  return (
    <div style={rootStyle}>
      <header style={headerStyle}>
        <h1 style={titleStyle}>BetHouse Dashboard</h1>
        <div style={tabsStyle}>
          <button
            style={tabBtn(activeTab === "betting")}
            onClick={() => setActiveTab("betting")}
          >
            Betting
          </button>
          <button
            style={tabBtn(activeTab === "explorer")}
            onClick={() => setActiveTab("explorer")}
          >
            Explorador de Rondas
          </button>
        </div>
      </header>

      <main style={mainStyle}>
        {activeTab === "betting" ? <BettingPage /> : <RoundExplorer />}
      </main>
    </div>
  );
}

export default App;
