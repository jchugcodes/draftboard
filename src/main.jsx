import React, { useEffect } from "react";
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

// The four position colours stacked as a mark. Reads as a tier stack, which is
// what the app is about, and it is the one place colour appears unprovoked.
const Mark = () => (
  <span className="grid h-5 w-5 grid-rows-4 overflow-hidden">
    <span className="bg-pos-QB" /><span className="bg-pos-RB" />
    <span className="bg-pos-WR" /><span className="bg-pos-TE" />
  </span>
);

function App() {
  const { state, dispatch } = useStore();
  const tab = state.ui.tab;
  const theme = state.ui.theme;
  const mergeCount = state.mergeQueue.length;

  // The token layer keys off a root attribute, so the whole palette swaps by
  // setting one string. theme-color follows so the mobile browser chrome and
  // the installed splash agree with the ground underneath them.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#09090b" : "#ffffff");
  }, [theme]);

  return (
    <div className="flex h-dvh flex-col bg-ground text-ink">
      <header className="border-b border-line">
        <div className="shell flex items-center gap-2 px-3 py-2">
          <div className="mr-1 flex select-none items-center gap-2">
            <Mark />
            <span className="hidden text-[13px] font-bold uppercase tracking-signage md:block">Draftboard</span>
          </div>
        <nav className="flex flex-1 gap-0.5 overflow-x-auto">
          {TABS.map((t) => {
            const on = tab === t.key;
            return (
              <button key={t.key} onClick={() => dispatch({ type: "SET_TAB", tab: t.key })}
                className={`taper whitespace-nowrap px-3 py-1.5 text-[11px] font-semibold uppercase tracking-label transition-colors ${
                  on ? "bg-ink text-ink-invert" : "text-ink-faint hover:bg-band hover:text-ink"}`}>
                <span className="md:hidden">{t.icon} </span>{t.label}
                {t.key === "settings" && mergeCount > 0 && (
                  <span className="num ml-1.5 rounded-full bg-warn px-1.5 text-[10px] font-bold text-ink-invert">{mergeCount}</span>
                )}
              </button>
            );
          })}
        </nav>
        <button
          onClick={() => dispatch({ type: "SET_UI", patch: { theme: theme === "dark" ? "light" : "dark" } })}
          title={theme === "dark" ? "Switch to the light board" : "Switch to the dark board"}
          aria-label="Toggle theme"
          className="taper border border-line px-2 py-1.5 text-[11px] text-ink-muted transition-colors hover:border-ink hover:text-ink">
          {theme === "dark" ? "☀" : "☾"}
        </button>
        <span className="hidden text-[10px] uppercase tracking-label text-ink-ghost lg:block">half-PPR · offline-ready</span>
        </div>
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
