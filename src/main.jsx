import React from "react";
import { createRoot } from "react-dom/client";
import { StoreProvider, useStore } from "./store.jsx";
import Board from "./board.jsx";
import { ImportsView, ByesView, VacatedView, HistoryView, SettingsView } from "./views.jsx";

const TABS = [
  { key: "board", label: "Board", icon: "▤" },
  { key: "imports", label: "Imports", icon: "⇥" },
  { key: "byes", label: "Byes", icon: "◔" },
  { key: "vacated", label: "Vacated", icon: "⇄" },
  { key: "history", label: "History", icon: "⟲" },
  { key: "settings", label: "Settings", icon: "⚙" },
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
              {t.key === "imports" && mergeCount > 0 && <span className="ml-1 rounded-full bg-amber-500/90 px-1.5 text-[10px] font-bold text-slate-950">{mergeCount}</span>}
            </button>
          ))}
        </nav>
        <span className="hidden text-[11px] text-slate-600 md:block">half-PPR rankings builder · offline-ready</span>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">
        {tab === "board" && <Board />}
        {tab === "imports" && <ImportsView />}
        {tab === "byes" && <ByesView />}
        {tab === "vacated" && <VacatedView />}
        {tab === "history" && <HistoryView />}
        {tab === "settings" && <SettingsView />}
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
