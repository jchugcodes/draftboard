import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { StoreProvider, useStore } from "./store.jsx";
import Board from "./board.jsx";
import { DataView, ByesView, VacatedView, HistoryView, SettingsView } from "./views.jsx";
import CompareView from "./compare.jsx";
import { Sun, Moon } from "./icons.jsx";

const TABS = [
  { key: "board", label: "Board" },
  { key: "compare", label: "Compare" },
  { key: "history", label: "History" },
  { key: "settings", label: "Setup" },
];

// The four position colours stacked as a mark. Reads as a tier stack, which is
// what the app is about, and it is the one place colour appears unprovoked.
const Mark = () => (
  <span className="grid h-5 w-5 grid-rows-4 overflow-hidden rounded-[3px]">
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
    <div className="flex h-dvh flex-col bg-ground-sunken text-ink">
      {/* On a 390px phone the four tabs plus a glyph apiece plus the wordmark
          ran past the right edge and pushed Setup — the tab that loads your
          data — off screen behind a scroll nobody would think to try. The
          glyphs said nothing the label did not, so they went; the wordmark and
          the strapline are the parts a phone can do without. */}
      <header className="border-b border-line bg-ground">
        <div className="shell flex items-center gap-1.5 px-2 py-2 md:gap-2 md:px-3">
          <div className="mr-0.5 flex shrink-0 select-none items-center gap-2 md:mr-1">
            <Mark />
            <span className="hidden text-[13px] font-bold uppercase tracking-signage md:block">Draftboard</span>
          </div>
          <nav className="flex flex-1 gap-0.5" aria-label="Sections">
            {TABS.map((t) => {
              const on = tab === t.key;
              return (
                <button key={t.key} onClick={() => dispatch({ type: "SET_TAB", tab: t.key })}
                  aria-current={on ? "page" : undefined}
                  className={`lean whitespace-nowrap px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-label transition-colors md:px-3.5 ${
                    on ? "bg-ink text-ink-invert" : "text-ink-faint hover:bg-band hover:text-ink"}`}>
                  <span>{t.label}</span>
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
            aria-label={theme === "dark" ? "Switch to the light board" : "Switch to the dark board"}
            className="shrink-0 rounded-[--r-sm] border border-line px-2 py-[7px] text-ink-muted transition-colors hover:border-ink hover:text-ink">
            {theme === "dark" ? <Sun /> : <Moon />}
          </button>
          <span className="hidden shrink-0 text-[10px] uppercase tracking-label text-ink-ghost lg:block">half-PPR · offline-ready</span>
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
