// Semantic names only. A component asks for "the faint ink" or "the tier band",
// never for slate-400, so flipping the ground between light and dark is a token
// swap in tw-input.css rather than a pass over every className in the app.
//
// Tokens are bare RGB channels, wrapped here with <alpha-value> so every
// utility keeps its opacity modifier: bg-panel/95, border-pos-QB/40.
const t = (name) => `rgb(var(--${name}) / <alpha-value>)`;

module.exports = {
  content: ["./public/index.html", "./src/**/*.{js,jsx}"],
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        ground: { DEFAULT: t("ground"), sunken: t("ground-sunken") },
        panel: { DEFAULT: t("panel"), raised: t("panel-raised") },
        band: { DEFAULT: t("band"), tier: t("band-tier") },
        theme: { DEFAULT: t("theme"), ink: t("theme-ink"), on: t("on-theme") },
        ink: {
          DEFAULT: t("ink"),
          muted: t("ink-muted"),
          faint: t("ink-faint"),
          ghost: t("ink-ghost"),
          invert: t("ink-invert"),
        },
        line: { DEFAULT: t("line"), strong: t("line-strong") },
        accent: t("accent"),
        focusring: t("focus"),
        ahead: t("ahead"),
        behind: t("behind"),
        warn: t("warn"),
        pos: {
          QB: t("pos-qb"), RB: t("pos-rb"), WR: t("pos-wr"),
          TE: t("pos-te"), K: t("pos-k"), DST: t("pos-dst"),
        },
        tag: {
          favorite: t("tag-favorite"), sleeper: t("tag-sleeper"), reliable: t("tag-reliable"),
          avoid: t("tag-avoid"), handcuff: t("tag-handcuff"),
        },
      },
      fontFamily: {
        sans: ['"Montserrat"', "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ['"Roboto Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      letterSpacing: { label: "0.12em", signage: "0.16em", marquee: "0.28em" },
    },
  },
  plugins: [],
};
