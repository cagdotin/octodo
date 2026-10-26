// The octopus's tuning panel: presets, the knobs (input[data-k]), the style, ramp and palette
// buttons (data-glyphs, data-ramp, data-pal, data-preset) and a reset button (data-reset), all
// inside one panel element. Every change applies at once and is kept in localStorage
// (pond-tune: the knobs that differ from the defaults; pond-palette), so every page that shows
// the octopus shares them. Loaded as a classic script; exposes `window.octoTune(panel, opts)`,
// where opts.sea() and opts.canvas() return the octopus's `sea` and its canvas (functions, so the
// octopus may live in an iframe that reloads). Returns { load, set, preset, setPalette, reset }.
{
  const store = {
    get: (k) => {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set: (k, v) => {
      try {
        localStorage.setItem(k, v);
      } catch {}
    },
  };

  const PCT = ["alpha", "glow", "dither", "hue", "grid", "lit"];
  const show = (k, v) =>
    k === "density"
      ? Math.max(5, Math.round(20 / v) / 2) + "px"
      : PCT.includes(k)
        ? v
          ? Math.round(v * 100) + "%"
          : "off"
        : "×" + v.toFixed(2);

  // whole looks to compare at a click: a palette, every look knob and the size (the rest of the
  // motion is left alone)
  const lum = (o) => ({ density: 0.85, glyphs: "luminous", ramp: "jelly", size: 1.4, ...o });
  const PRESETS = {
    jellyfish: lum({
      pal: "abyss",
      alpha: 0.85,
      glow: 0.5,
      dither: 0.55,
      hue: 0.55,
      grid: 0.5,
      lit: 0.5,
    }),
    biolume: lum({
      pal: "biolume",
      alpha: 0.9,
      glow: 0.8,
      dither: 0.65,
      hue: 0.8,
      grid: 0.3,
      lit: 0.6,
    }),
    terminal: lum({
      pal: "phosphor",
      density: 1.05,
      ramp: "binary",
      alpha: 0.9,
      glow: 0.65,
      dither: 0.4,
      hue: 0.2,
      grid: 0.8,
      lit: 0.35,
    }),
    amber: lum({
      pal: "amber",
      density: 0.95,
      ramp: "classic",
      alpha: 0.9,
      glow: 0.6,
      dither: 0.45,
      hue: 0.35,
      grid: 0.6,
      lit: 0.4,
    }),
    ice: lum({
      pal: "ice",
      ramp: "classic",
      alpha: 0.75,
      glow: 0.3,
      dither: 0.7,
      hue: 0.4,
      grid: 0.25,
      lit: 0.3,
    }),
    minimal: lum({
      pal: "ink",
      ramp: "classic",
      alpha: 0.9,
      glow: 0,
      dither: 0.3,
      hue: 0,
      grid: 0,
      lit: 0,
    }),
    "ember-tiles": { pal: "ember", density: 1.8, glyphs: "ascii", size: 1.1 },
    "ink-tiles": { pal: "ink", density: 1.8, glyphs: "ascii", size: 1.1 },
  };
  const LOOK = [
    "density",
    "glyphs",
    "ramp",
    "size",
    "alpha",
    "glow",
    "dither",
    "hue",
    "grid",
    "lit",
  ];
  const DEFAULT_PALETTE = "abyss";

  window.octoTune = (panel, { sea, canvas }) => {
    const knobs = panel.querySelectorAll("input[data-k]");
    const press = (attr, value) =>
      panel
        .querySelectorAll(`[data-${attr}]`)
        .forEach((b) => b.setAttribute("aria-pressed", b.dataset[attr] === value));
    let tuned;

    function marks() {
      for (const b of panel.querySelectorAll("[data-preset]")) {
        const p = PRESETS[b.dataset.preset];
        const on =
          p.pal === canvas().dataset.palette &&
          Object.keys(p).every((k) => k === "pal" || tuned[k] === p[k]);
        b.setAttribute("aria-pressed", on);
      }
    }
    // the octopus's palette lives on its canvas: tuning it never restyles the page
    function setPalette(p) {
      canvas().dataset.palette = p;
      press("pal", p);
      store.set("pond-palette", p);
      sea().recolor();
      if (tuned) marks();
    }
    function set(opts) {
      tuned = sea().set(opts);
      const defaults = sea().defaults;
      const changed = {};
      for (const k in tuned) if (tuned[k] !== defaults[k]) changed[k] = tuned[k];
      store.set("pond-tune", JSON.stringify(changed));
      knobs.forEach((i) => {
        i.value = tuned[i.dataset.k];
        i.nextElementSibling.textContent = show(i.dataset.k, tuned[i.dataset.k]);
      });
      press("glyphs", tuned.glyphs);
      press("ramp", tuned.ramp);
      panel.dataset.style = tuned.glyphs;
      marks();
    }
    function preset(name) {
      const { pal, ...look } = PRESETS[name];
      const opts = {};
      for (const k of LOOK) opts[k] = k in look ? look[k] : sea().defaults[k];
      set(opts);
      setPalette(pal);
    }
    function reset() {
      set(sea().defaults);
      setPalette(DEFAULT_PALETTE);
    }
    // apply what this browser has kept (again after the octopus reloads)
    function load() {
      setPalette(store.get("pond-palette") || DEFAULT_PALETTE);
      let kept = {};
      try {
        kept = JSON.parse(store.get("pond-tune") || "{}") || {};
      } catch {}
      set(kept);
    }

    knobs.forEach((i) => (i.oninput = () => set({ [i.dataset.k]: +i.value })));
    panel
      .querySelectorAll("[data-glyphs]")
      .forEach((b) => (b.onclick = () => set({ glyphs: b.dataset.glyphs })));
    panel
      .querySelectorAll("[data-ramp]")
      .forEach((b) => (b.onclick = () => set({ ramp: b.dataset.ramp })));
    panel
      .querySelectorAll("[data-pal]")
      .forEach((b) => (b.onclick = () => setPalette(b.dataset.pal)));
    panel
      .querySelectorAll("[data-preset]")
      .forEach((b) => (b.onclick = () => preset(b.dataset.preset)));
    panel.querySelectorAll("[data-reset]").forEach((b) => (b.onclick = reset));

    return { load, set, preset, setPalette, reset };
  };
  window.octoTune.store = store;
  window.octoTune.PRESETS = PRESETS;
}
