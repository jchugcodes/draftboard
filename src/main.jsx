import React from "react";
import { createRoot } from "react-dom/client";
import { StoreProvider, useStore } from "./store.jsx";
import Board from "./board.jsx";
import { DataView, ByesView, VacatedView, HistoryView, SettingsView } from "./views.jsx";
import CompareView from "./compare.jsx";

const TABS = [
  { key: "board", label: "Board", icon: "▤" },
  { key: "compare", label: "Compare", icon: "⇹" },
  { key: "history", label: "History", icon: "⟲" },
  { key: "settings", label: "Setup", icon: "⚙" },
];

function App() {
  const { state, dispatch } = useStore();
  const tab = state.ui.tab;
  const mergeCount = state.mergeQueue.length;
  return (
    <div className="flex h-dvh flex-col bg-slate-950 text-slate-100">
      <header className="flex items-center gap-1 border-b border-slate-800 px-2 py-1.5 md:px-3">
        <div className="mr-2 flex items-center gap-1.5 select-none">
          <span className="grid h-5 w-5 grid-rows-4 overflow-hidden rounded-sm">
            <span className="bg-rose-400" /><span className="bg-emerald-400" /><span className="bg-sky-400" /><span className="bg-amber-400" />
          </span>
          <span className="hidden text-sm font-bold tracking-tight md:block">DraftBoard</span>
        </div>
        <nav className="flex flex-1 gap-0.5 overflow-x-auto">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => dispatch({ type: "SET_TAB", tab: t.key })}
              className={`rounded px-2.5 py-1 text-sm whitespace-nowrap ${tab === t.key ? "bg-slate-800 font-medium text-white" : "text-slate-400 hover:text-slate-200"}`}>
              <span className="md:hidden">{t.icon} </span>{t.label}
              {t.key === "settings" && mergeCount > 0 && <span className="ml-1 rounded-full bg-amber-500/90 px-1.5 text-[10px] font-bold text-slate-950">{mergeCount}</span>}
            </button>
          ))}
        </nav>
        <span className="hidden text-[11px] text-slate-600 md:block">half-PPR rankings builder · offline-ready</span>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">
        {tab === "board" && <Board />}
        {tab === "compare" && <CompareView />}
        {tab === "history" && <HistoryView />}
        {/* Setup holds everything that is not the act of ranking: league rules,
            data, and the two reference readouts that used to be their own tabs. */}
        {tab === "settings" && (
          <>
            <SettingsView />
            <DataView />
            <ByesView />
            <VacatedView />
          </>
        )}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <StoreProvider><App /></StoreProvider>
);

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
