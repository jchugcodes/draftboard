import React, { useMemo, useState } from "react";
import { useStore } from "./store.jsx";
import { POSITIONS, POS_STYLE, fmt, daysAgo } from "./util.js";

const posStyle = (pos) => POS_STYLE[pos] || POS_STYLE.DST;

// Where every site has a player, side by side with my rank. Sorted by
// disagreement by default, because the players you rank the same as everyone
// else are exactly the ones you do not need to think about.
export default function CompareView() {
  const { state, dispatch } = useStore();
  const [posFilter, setPosFilter] = useState(null);
  const [sortKey, setSortKey] = useState("gap");
  const [limit, setLimit] = useState(60);

  const cols = useMemo(
    () => (state.sources || []).filter((s) => s.type !== "proj"),
    [state.sources]
  );

  const rows = useMemo(() => {
    const out = [];
    (state.myRanks || []).forEach((id, i) => {
      const p = state.players[id];
      if (!p) return;
      if (posFilter && p.pos !== posFilter) return;
      const vals = cols.map((s) => s.map?.[id] ?? null);
      const known = vals.filter((v) => v != null);
      if (!known.length) return;
      const consensus = known.reduce((a, b) => a + b, 0) / known.length;
      out.push({
        id, p, myRank: i + 1, vals,
        consensus,
        gap: (i + 1) - consensus,          // negative: I am higher than the room
        spread: Math.max(...known) - Math.min(...known),
      });
    });
    const by = {
      gap: (a, b) => Math.abs(b.gap) - Math.abs(a.gap),
      mine: (a, b) => a.myRank - b.myRank,
      consensus: (a, b) => a.consensus - b.consensus,
      spread: (a, b) => b.spread - a.spread,
    }[sortKey];
    return out.sort(by);
  }, [state.myRanks, state.players, cols, posFilter, sortKey]);

  if (!cols.length) {
    return (
      <div className="mx-auto max-w-md p-8 text-center text-sm text-ink-muted">
        No ranking sources yet. Load data from <span className="text-ink">Setup</span> and every site becomes a
        column here.
      </div>
    );
  }

  const th = "px-2 py-1 text-left text-[11px] font-medium uppercase tracking-wide text-ink-faint";
  const sortBtn = (key, label, title) => (
    <button title={title} onClick={() => setSortKey(key)}
      className={sortKey === key ? "text-accent" : "hover:text-ink"}>{label}{sortKey === key ? " ↓" : ""}</button>
  );

  return (
    <div className="shell p-3 md:p-4">
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-ink-faint">Position</span>
        <button onClick={() => setPosFilter(null)}
          className={`rounded border px-2 py-0.5 text-xs font-bold ${!posFilter ? "border-accent text-accent" : "border-line text-ink-faint hover:border-line-strong"}`}>All</button>
        {POSITIONS.map((pos) => (
          <button key={pos} onClick={() => setPosFilter(posFilter === pos ? null : pos)}
            className={`rounded border px-2 py-0.5 text-xs font-bold ${posFilter === pos ? posStyle(pos).chip : "border-line text-ink-faint hover:border-line-strong"}`}>
            {pos}
          </button>
        ))}
        <span className="grow" />
        <span className="text-[11px] text-ink-faint">{rows.length} players · {cols.length} sources</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className={th}>{sortBtn("mine", "Me", "My rank")}</th>
              <th className={th}>Player</th>
              {cols.map((s) => (
                <th key={s.id} className={th} title={`${s.name} · ${s.type.toUpperCase()}`}>
                  <span className="whitespace-nowrap">{s.name}{daysAgo(s.date) > 7 && <span className="text-warn">*</span>}</span>
                </th>
              ))}
              <th className={th}>{sortBtn("consensus", "Cons", "Mean across sources")}</th>
              <th className={th}>{sortBtn("spread", "Spread", "How much the sites disagree with each other")}</th>
              <th className={th}>{sortBtn("gap", "Me vs cons", "My rank minus consensus. Negative = I am higher on him.")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((r) => {
              const ps = posStyle(r.p.pos);
              const strong = Math.abs(r.gap) >= 12;
              return (
                <tr key={r.id} onClick={() => { dispatch({ type: "SET_TAB", tab: "board" }); }}
                  className="cursor-pointer border-b border-line hover:bg-panel-raised">
                  <td className="px-2 py-1 tabular-nums text-ink-muted">{r.myRank}</td>
                  <td className="px-2 py-1 whitespace-nowrap">
                    <span className={`mr-1.5 text-[11px] font-bold ${ps.text}`}>{r.p.pos}</span>
                    <span className="font-medium">{r.p.name}</span>
                    <span className="ml-1 text-[11px] text-ink-faint">{r.p.team || "FA"}</span>
                  </td>
                  {r.vals.map((v, i) => {
                    // Shade each cell by how far that site sits from my rank.
                    const d = v == null ? null : v - r.myRank;
                    const cls = d == null ? "text-ink-ghost"
                      : d >= 12 ? "text-ahead"
                      : d <= -12 ? "text-behind"
                      : "text-ink-muted";
                    return <td key={cols[i].id} className={`px-2 py-1 tabular-nums ${cls}`}>{v == null ? "–" : fmt(v, 0)}</td>;
                  })}
                  <td className="px-2 py-1 tabular-nums text-ink-muted">{fmt(r.consensus, 1)}</td>
                  <td className={`px-2 py-1 tabular-nums ${r.spread > 24 ? "text-warn" : "text-ink-faint"}`}>{fmt(r.spread, 0)}</td>
                  <td className={`px-2 py-1 tabular-nums font-medium ${r.gap < 0 ? "text-behind" : r.gap > 0 ? "text-ahead" : "text-ink-faint"}`}>
                    {r.gap > 0 ? "+" : ""}{fmt(r.gap, 0)}{strong && <span className="ml-1 text-[10px] uppercase opacity-70">{r.gap < 0 ? "reach" : "wait"}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {rows.length > limit && (
        <button onClick={() => setLimit(limit + 60)}
          className="mt-3 rounded border border-line px-3 py-1 text-xs text-ink-muted hover:border-accent">
          Show 60 more
        </button>
      )}
      <p className="mt-3 text-[11px] text-ink-faint">
        Green means a site ranks him later than you do — you could wait. Red means they are higher — you would have to
        reach. Sorted by disagreement, so the top of this list is where your board actually differs from the market.
      </p>
    </div>
  );
}
