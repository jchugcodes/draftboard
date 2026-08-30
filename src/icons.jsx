// One icon system, so the app stops borrowing its symbols from whichever font
// happens to carry them.
//
// Eighteen of these used to be Unicode characters set in Montserrat — ✕ ⋯ ⠿ ⚠
// ✎ ⛓ ☾ ↕ — and a text glyph is drawn to a type designer's brief, not ours. They
// arrived at different optical weights, sat on different baselines, and changed
// shape between platforms. Every one is now the same drawing: a 16-unit grid,
// 1.5 stroke, round caps, currentColor. They inherit the text colour they sit
// in and line up with it because they share its box.
//
// Two exceptions are filled rather than stroked, and deliberately: Caret and
// Dot are data, not chrome. A rank moving up is a value in a column, and it
// needs the same visual weight as the number beside it, which a hairline
// outline cannot carry at 10px.
import React from "react";

const Svg = ({ size = 14, children, ...rest }) => (
  <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true" focusable="false"
    className="inline-block shrink-0 align-[-0.15em]" {...rest}>
    {children}
  </svg>
);

export const Search = (p) => <Svg {...p}><circle cx="7" cy="7" r="4.25" /><path d="M10.2 10.2 14 14" /></Svg>;
export const Close = (p) => <Svg {...p}><path d="M4 4l8 8M12 4l-8 8" /></Svg>;
export const Check = (p) => <Svg {...p}><path d="M3 8.5 6.5 12 13 4.5" /></Svg>;
export const Plus = (p) => <Svg {...p}><path d="M8 3.5v9M3.5 8h9" /></Svg>;

// Disclosure and sort share one chevron so "there is more this way" is always
// the same shape, only rotated.
export const Chevron = ({ dir = "down", ...p }) => (
  <Svg {...p} style={{ transform: `rotate(${{ down: 0, up: 180, left: 90, right: -90 }[dir]}deg)`, ...(p.style || {}) }}>
    <path d="M3.5 6 8 10.5 12.5 6" />
  </Svg>
);
export const Sort = ({ active, dir = "down", ...p }) =>
  active
    ? <Chevron dir={dir} {...p} />
    : <Svg {...p}><path d="M4.5 6.5 8 3l3.5 3.5M4.5 9.5 8 13l3.5-3.5" /></Svg>;

export const Ellipsis = (p) => (
  <Svg {...p} stroke="none" fill="currentColor">
    <circle cx="3.25" cy="8" r="1.15" /><circle cx="8" cy="8" r="1.15" /><circle cx="12.75" cy="8" r="1.15" />
  </Svg>
);

// The tier divider handle. Six dots is the universal "pick this up" — the same
// shape a list row uses everywhere — and it reads as grabbable at 14px in a way
// the braille character it replaces never did.
export const Grip = (p) => (
  <Svg {...p} stroke="none" fill="currentColor">
    {[4.5, 8, 11.5].map((y) => (
      <React.Fragment key={y}><circle cx="6" cy={y} r="1.1" /><circle cx="10" cy={y} r="1.1" /></React.Fragment>
    ))}
  </Svg>
);

export const Refresh = (p) => (
  <Svg {...p}><path d="M13.5 8a5.5 5.5 0 1 1-1.7-3.97" /><path d="M13.7 2.4v3.1h-3.1" /></Svg>
);

export const Moon = (p) => <Svg {...p}><path d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8Z" /></Svg>;
export const Sun = (p) => (
  <Svg {...p}><circle cx="8" cy="8" r="3" />
    <path d="M8 1.2v1.4M8 13.4v1.4M14.8 8h-1.4M2.6 8H1.2M12.8 3.2l-1 1M4.2 11.8l-1 1M12.8 12.8l-1-1M4.2 4.2l-1-1" />
  </Svg>
);

export const Warning = (p) => (
  <Svg {...p}><path d="M8 2.6 14.6 13.4H1.4L8 2.6Z" /><path d="M8 6.6v3.1" /><circle cx="8" cy="11.6" r=".3" fill="currentColor" /></Svg>
);

// A handcuff: the backup who inherits the job. Two links, which is the picture.
export const Link = (p) => (
  <Svg {...p}><path d="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2.1-2.1a2.6 2.6 0 1 0-3.7-3.7l-.8.8" />
    <path d="M9.4 6.6a2.6 2.6 0 0 0-3.7 0L3.6 8.7a2.6 2.6 0 1 0 3.7 3.7l.8-.8" /></Svg>
);
export const Pencil = (p) => (
  <Svg {...p}><path d="M11.3 2.6 13.4 4.7 5.6 12.5l-3 .9.9-3 7.8-7.8Z" /></Svg>
);
export const External = (p) => (
  <Svg {...p}><path d="M9.5 2.5H13.5V6.5" /><path d="M13.5 2.5 7.5 8.5" /><path d="M12 9.6v3a.9.9 0 0 1-.9.9H3.4a.9.9 0 0 1-.9-.9V4.9a.9.9 0 0 1 .9-.9h3" /></Svg>
);

// Filled, because these are values rather than chrome. A rank that moved has to
// carry the same weight as the number beside it.
export const Caret = ({ dir = "up", size = 9, ...p }) => (
  <svg viewBox="0 0 10 10" width={size} height={size} fill="currentColor" aria-hidden="true" focusable="false"
    className="inline-block shrink-0 align-[-0.05em]" {...p}>
    <path d={dir === "up" ? "M5 1.6 9 8.4H1L5 1.6Z" : "M5 8.4 1 1.6h8L5 8.4Z"} />
  </svg>
);
export const Dot = ({ size = 6, ...p }) => (
  <svg viewBox="0 0 6 6" width={size} height={size} fill="currentColor" aria-hidden="true" focusable="false"
    className="inline-block shrink-0 align-middle" {...p}><circle cx="3" cy="3" r="1.6" /></svg>
);
