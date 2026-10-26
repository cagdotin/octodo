// The octopus that swims behind the landing page. Loaded as a classic script before the page's
// own script; exposes `window.sea` with start(), recolor() and set() (the tuning panel's knobs, see
// DEFAULTS). Reads the page's data-theme and its canvas's data-palette for colours and honours
// prefers-reduced-motion.
{
  const root = document.documentElement;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------------------------------------------------------------------------------------
  // The octopus. A mantle and head driven by a jet-swimming cycle, and eight arms that are
  // soft chains pulled by water drag and a muscle pose. Drawn as a grey-level shading field
  // plus a pale-spot pattern, then sampled into small tiles.
  // ---------------------------------------------------------------------------------------
  window.sea = (() => {
    const cv = document.getElementById("sea");
    const ctx = cv.getContext("2d");
    // Knobs the page's tuning panel turns. density: cells per 10px (v5 was 1, 1.8 is 5.5px
    // tiles, 0.85 is 12px); glyphs: none | subtle | ascii | luminous; size: body scale; speed:
    // cruising thrust (and shorter rests); react: how far off the pointer frightens it; scroll:
    // how far scrolling turns it. The rest only shape the luminous style: ramp: the characters
    // (jelly | classic | binary); alpha: overall opacity; glow: a soft bloom under the glyphs;
    // dither: how far the edges break up into specks; hue: how far the arms drift toward the
    // palette's tint; grid: a faint cell grid behind; lit: how many bright cells are inverted.
    const DEFAULTS = {
      density: 0.85,
      glyphs: "luminous",
      ramp: "jelly",
      size: 1.4,
      speed: 1.9,
      react: 0.35,
      scroll: 1.4,
      alpha: 0.85,
      glow: 0.5,
      dither: 0.55,
      hue: 0.55,
      grid: 0.5,
      lit: 0.5,
    };
    const CHOICES = {
      glyphs: ["none", "subtle", "ascii", "luminous"],
      ramp: ["jelly", "classic", "binary"],
    };
    const tune = { ...DEFAULTS };
    let CELL = 10; // tile size in px, set by resize() from tune.density
    let SS = 2; // supersampling per cell, 3 for the larger cells
    const shade = document.createElement("canvas");
    const pat = document.createElement("canvas");
    const sx = shade.getContext("2d", { willReadFrequently: true });
    const px = pat.getContext("2d", { willReadFrequently: true });
    let W = 0,
      H = 0,
      cols = 0,
      rows = 0,
      dpr = 1,
      S = 1,
      running = false;
    let C = {};

    const PALETTES = {
      ember: {
        dark: {
          hi: "#efe8df",
          pale: "#b9b2a9",
          grey: "#6f6a64",
          fringe: "#3a3835",
          lt: "#f2a462",
          mid: "#e2803d",
          deep: "#b4552c",
          ink: "#0d0d0c",
          glyph: "rgba(18,16,14,.42)",
          snow: "rgba(240,236,229,",
        },
        light: {
          hi: "#fffdf9",
          pale: "#d9d1c6",
          grey: "#a49c92",
          fringe: "#e3ded6",
          lt: "#f0a35f",
          mid: "#dc7a37",
          deep: "#b0522a",
          ink: "#3b4552",
          glyph: "rgba(30,26,22,.38)",
          snow: "rgba(34,33,31,",
        },
      },
      ink: {
        dark: {
          hi: "#eaeef2",
          pale: "#aab5c0",
          grey: "#68727c",
          fringe: "#33383e",
          lt: "#a9c8e6",
          mid: "#6f9ac6",
          deep: "#45698f",
          ink: "#0b0d10",
          glyph: "rgba(12,16,22,.42)",
          snow: "rgba(240,236,229,",
        },
        light: {
          hi: "#ffffff",
          pale: "#ccd5de",
          grey: "#929ca6",
          fringe: "#e0e4e8",
          lt: "#8fb6dc",
          mid: "#5584b3",
          deep: "#36597e",
          ink: "#2a3340",
          glyph: "rgba(16,22,30,.4)",
          snow: "rgba(34,33,31,",
        },
      },
      // the brand page's paper print: ink tiles on paper, or paper tiles on charcoal
      paper: {
        dark: {
          hi: "#fffdf9",
          pale: "#cfc7bc",
          grey: "#77716a",
          fringe: "#33312e",
          lt: "#f3eee7",
          mid: "#dcd4c9",
          deep: "#b3a99d",
          ink: "#171716",
          glyph: "rgba(23,23,22,.4)",
          snow: "rgba(240,236,229,",
        },
        light: {
          hi: "#6b7785",
          pale: "#8d97a3",
          grey: "#a7aeb6",
          fringe: "#ddd5cb",
          lt: "#3b4856",
          mid: "#26313c",
          deep: "#14202b",
          ink: "#f8f4ef",
          glyph: "rgba(248,244,239,.28)",
          snow: "rgba(34,33,31,",
        },
      },
      // one colour, no shading: every covered cell is a tile, the eyes are holes
      onebit: {
        dark: { flat: true, on: "#f0ece5", ink: "#171716", snow: "rgba(240,236,229," },
        light: { flat: true, on: "#22211f", ink: "#f3f1ed", snow: "rgba(34,33,31," },
      },
    };
    // The luminous style's colours, per palette and theme: dim, mid and bright along the
    // brightness ramp, the tint the arms drift toward, a lit cell's square, and the page behind
    // it (the glyph on a lit cell, and the eyes). On light pages "bright" is the darkest ink.
    // Palettes without tile colours of their own (abyss and the rest) get them from these.
    const GLOW = {
      abyss: {
        dark: ["#3a6688", "#56bdd2", "#d2fbf8", "#a796f7", "#e4fdff", "#090c12"],
        light: ["#9bb4c6", "#2c7891", "#0d3c50", "#5b48c0", "#0d3c50", "#f3f1ed"],
      },
      phosphor: {
        dark: ["#1d4a2a", "#46cc68", "#cfffd6", "#b6e35a", "#dcffe0", "#080d09"],
        light: ["#a3c4aa", "#2c8545", "#0f4a24", "#5d7d12", "#0f4a24", "#f3f1ed"],
      },
      amber: {
        dark: ["#4d3415", "#e09a35", "#ffe2a8", "#ff7347", "#fff0cc", "#100c07"],
        light: ["#d6bd98", "#a5600c", "#683705", "#b23f18", "#683705", "#f3f1ed"],
      },
      biolume: {
        dark: ["#16484a", "#36d1bc", "#c8fff3", "#ff5ec4", "#ffd6f2", "#060b0c"],
        light: ["#9cc8c1", "#108575", "#094b42", "#bd2289", "#094b42", "#f3f1ed"],
      },
      ice: {
        dark: ["#3b4b5e", "#9fc0e2", "#f5fbff", "#c5c9ff", "#ffffff", "#0b0e12"],
        light: ["#b5c3d1", "#4b6b8e", "#1b324c", "#5157a6", "#1b324c", "#f3f1ed"],
      },
      ember: {
        dark: ["#6a3a1e", "#e2803d", "#ffdcb4", "#f6c35b", "#fff1e0", "#171716"],
        light: ["#d9b79c", "#c0642b", "#7a3512", "#b8892a", "#7a3512", "#f3f1ed"],
      },
      ink: {
        dark: ["#3c5672", "#6f9ac6", "#dce9f6", "#a59ee2", "#f2f7fc", "#171716"],
        light: ["#b3c2d1", "#4a77a5", "#1f3c5c", "#6158a8", "#1f3c5c", "#f3f1ed"],
      },
      paper: {
        dark: ["#5a5650", "#b9b1a6", "#fffdf9", "#d9c6a8", "#fffdf9", "#171716"],
        light: ["#b5ada3", "#5d6873", "#14202b", "#5e4b36", "#14202b", "#f3f1ed"],
      },
      onebit: {
        dark: ["#f0ece5", "#f0ece5", "#f0ece5", "#f0ece5", "#f0ece5", "#171716"],
        light: ["#22211f", "#22211f", "#22211f", "#22211f", "#22211f", "#f3f1ed"],
      },
    };
    const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const mixRGB = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
    let dark = true,
      LUT = [], // LUT[hue][level]: the luminous style's colours, see recolor()
      LIT = "",
      BG = "",
      GRIDC = "";
    const LV = 10, // brightness levels
      HV = 4; // hue steps toward the tint
    function recolor() {
      // the octopus's own palette sits on its canvas, so tuning it never restyles the page; the
      // page's palette is only a fallback (the lab sets that one)
      const want = cv.dataset.palette || root.dataset.palette;
      const name = PALETTES[want] || GLOW[want] ? want : "ember";
      dark = (root.dataset.theme || "dark") === "dark";
      const theme = dark ? "dark" : "light";
      const [p0, g1, g2, tint, lit, bg] = GLOW[name][theme].map(rgb);
      const g0 = dark ? p0 : mixRGB(p0, g1, 0.4); // pale ink fades out on paper
      const css = (c) => `rgb(${c.join(",")})`;
      C = PALETTES[name]?.[theme] || {
        hi: css(mixRGB(g2, g1, 0.15)),
        pale: css(mixRGB(g1, g2, 0.6)),
        grey: css(g0),
        fringe: css(mixRGB(bg, g0, 0.55)),
        lt: css(mixRGB(g1, g2, 0.35)),
        mid: css(g1),
        deep: css(mixRGB(g0, g1, 0.45)),
        ink: css(bg),
        glyph: `rgba(${bg.join(",")},.42)`,
        snow: `rgba(${mixRGB(g1, g2, 0.5).join(",")},`,
      };
      // dim → mid over the lower half of the ramp, mid → bright over the upper
      LUT = Array.from({ length: HV }, (_, h) =>
        Array.from({ length: LV }, (_, l) => {
          const v = l / (LV - 1);
          const c = v < 0.5 ? mixRGB(g0, g1, v * 2) : mixRGB(g1, g2, (v - 0.5) * 2);
          return css(mixRGB(c, tint, (h / (HV - 1)) * (0.4 + 0.5 * (1 - v))));
        }),
      );
      LIT = css(lit);
      BG = css(bg);
      GRIDC = css(mixRGB(bg, g1, 0.5));
      if (W && (reduced || !running)) draw();
    }

    // Body size (px), and the strip the page's text column covers, which the animal avoids.
    let ML = 0,
      MW = 0,
      AL = 0,
      colL = 0,
      colR = 0,
      band = false;

    function resize() {
      W = innerWidth;
      H = innerHeight;
      dpr = Math.min(devicePixelRatio || 1, 2);
      // in half pixels, so tiles land on whole device pixels
      CELL = Math.max(5, Math.round(20 / tune.density) / 2);
      SS = CELL >= 9 ? 3 : 2;
      cv.width = W * dpr;
      cv.height = H * dpr;
      cols = Math.ceil(W / CELL);
      rows = Math.ceil(H / CELL);
      for (const [c, x] of [
        [shade, sx],
        [pat, px],
      ]) {
        c.width = cols * SS;
        c.height = rows * SS;
        x.setTransform(SS / CELL, 0, 0, SS / CELL, 0, 0);
      }
      const S0 = S;
      S = (W < 700 ? 0.85 : W < 1100 ? 1.05 : 1.2) * tune.size;
      // a new size scales the arms with the body, about the neck, so none is stretched or
      // squeezed by the solver in one step
      if (S0 && S !== S0)
        for (const a of ARMS)
          for (const b of [a.p, a.q, a.t, a.tp])
            for (let j = 0; j < b.length; j += 2) {
              b[j] = O.x + (b[j] - O.x) * (S / S0);
              b[j + 1] = O.y + (b[j + 1] - O.y) * (S / S0);
            }
      ML = 46 * S;
      MW = 42 * S;
      AL = 150 * S;
      const col = document.querySelector(".hero .col") || document.querySelector(".col");
      const r = col ? col.getBoundingClientRect() : { left: 0, right: 0 };
      colL = r.left;
      colR = r.right;
      band = W - colR > 300;
    }

    // --- helpers ------------------------------------------------------------------------
    let random = Math.random; // sea.lab.seed() swaps in a seeded one
    const rnd = (a, b) => a + random() * (b - a);
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const ease = (t) => t * t * (3 - 2 * t);
    const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    const approach = (v, to, rate, dt) => v + (to - v) * Math.min(1, rate * dt);

    // --- the animal ---------------------------------------------------------------------
    // O.x/O.y is the neck, between head and mantle; th points the way the mantle leads.
    const O = {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      th: 0,
      w: 0,
      mode: "drift", // drift | swim
      phase: 0,
      period: 1.6,
      strokes: 0,
      thrust: 1,
      hurry: false, // fleeing the pointer
      settle: false, // the fright is over: calm down at the end of this stroke
      fear: 0, // 0..1, builds while the pointer stays close or follows, scales the escape
      fleeA: 0, // smoothed escape heading
      fleeMin: 0, // a fright lasts at least this long
      grip: 0, // 0..1, eases in while fleeing: how firmly the arms are held to their reach
      rest: 3,
      burst: 3, // strokes in the next bout, chosen with the rest before it
      wx: 0,
      wy: 0,
      wpAge: 0,
      wander: 0,
      edgeSide: 0, // which way it is turning from an edge ahead, -1 | 0 | 1
      edgeK: 0, // 0..1, how close the edge ahead is, against how far it needs to turn away
      weave: 0, // the phase of the path's slow weave (see desiredHeading())
      style: "jet", // jet | web: a bout of jetting, or of slower web pulses (see update())
      pc: 0.28, // the part of the stroke cycle that is the jet and the close
      shut: 0, // 1 through the close and glide, falling to 0 as the arms open again
      loose: 0, // like shut, but rising only once the arms are well on their way in
      gather: 0, // 0..1, how firmly each arm is kept on its own side of the axis (see midline())
      sv: 0, // scroll speed, px/s, low-passed
      sk: 0, // 0..1, how much scrolling is going on, eased
      ws: 0, // the turn scrolling is giving it, rad/s
      arch: 0, // rad, how far the body bends into its turn (see ARCH)
      reach: 6.25, // how far from the axis an arm may stray, mantle lengths (see REACH)
    };
    // the muscle pose the arms are pulled toward, shaped by the stroke cycle
    const pose = { spread: 0.6, curl: 1, relax: 1, wave: 0.6, squeeze: 0, tilt: 0 };
    let power = 0;

    const N = 16; // segments per arm
    const ARMS = Array.from({ length: 8 }, (_, i) => {
      const s = (i - 3.5) / 3.5;
      return {
        s,
        far: i % 2 === 1,
        len: rnd(0.86, 1.06) * (1 - 0.08 * Math.abs(s)),
        w: [rnd(0.22, 0.5), rnd(0.3, 0.6), rnd(0.5, 0.9)],
        ph: [rnd(0, 6.28), rnd(0, 6.28), rnd(0, 6.28)],
        p: new Float32Array((N + 1) * 2), // node positions
        q: new Float32Array((N + 1) * 2), // previous positions (verlet)
        t: new Float32Array((N + 1) * 2), // where the muscles want them
        tp: new Float32Array((N + 1) * 2), // ...and where they wanted them a step ago
        sp: 0.6, // its own spread: each arm follows the stroke at its own pace (see update())
        rate: rnd(0.8, 1.2),
        ex: 0, // 0..1, how far it is reaching out to explore (see explore())
        exT: -1, // ...and how far through the reach, 0..1 (below 0: not reaching)
      };
    });
    // slow, smooth, per-arm noise in [-1, 1]
    const nz = (a, t, k) =>
      0.62 * Math.sin(t * a.w[k] + a.ph[k]) + 0.38 * Math.sin(t * a.w[k] * 2.31 + a.ph[k] * 1.7);

    const frame0 = (a = O.th) => {
      const f0 = Math.cos(a),
        f1 = Math.sin(a);
      return [f0, f1, -f1, f0];
    };
    // The body bends into a turn, concave toward it: the mantle leans in by O.arch, the head
    // and the arms' roots, behind the neck, the other way about it, so the arms (their pose,
    // the reach and the midline all hang off this frame) trail around the curve.
    const ARCH = 0.34,
      ARCH_HEAD = 0.35,
      ARCH_ARMS = 0.6;
    const armFrame = () => frame0(O.th - ARCH_ARMS * O.arch);

    // The pose an arm's muscles hold, in world space: rooted on the crown behind the head,
    // fanned by `spread`, with a tip curl and a slow wave travelling out along it.
    function armTarget(a, t) {
      const [f0, f1, n0, n1] = armFrame();
      const s = a.s,
        sg = Math.sign(s);
      const ra = -0.36 * ML + Math.abs(s) * 0.06 * ML,
        rb = s * MW * 0.36;
      let x = O.x + f0 * ra + n0 * rb,
        y = O.y + f1 * ra + n1 * rb;
      const T = a.t;
      T[0] = x;
      T[1] = y;
      // its own spread, never quite its neighbours' (see update())
      const spread = clamp(
        a.sp * (1 + 0.06 * nz(a, t, 0)) + pose.relax * 0.1 * nz(a, t, 0),
        -0.12,
        1.1,
      );
      const e = a.ex;
      // positive s sits on the +n side; rotating by -s fans it out to that side (and an arm
      // reaching out to explore swings a little further out)
      let ang =
        Math.atan2(f1, f0) +
        Math.PI -
        s * (0.08 + 0.75 * spread) -
        sg * 0.3 * e +
        pose.relax * 0.16 * nz(a, t, 1);
      // tip curl: inward (toward the axis, a bell) when swimming, wandering when relaxed, and
      // straightened out by reaching
      const c =
        pose.curl *
        (sg * 0.6 * (1 - pose.relax) + pose.relax * (0.45 * sg + 0.65 * nz(a, t, 2))) *
        (1 - 0.8 * e);
      const seg = (a.len * AL) / N;
      for (let j = 1; j <= N; j++) {
        const u = (j - 0.5) / N;
        const k =
          -s * spread * 0.5 +
          sg * pose.relax * 0.55 * spread +
          c * 8 * u * u * u +
          // the reaching arm's tip curls into a spiral, away from the body
          -sg * 10 * e * e * Math.max(0, (u - 0.7) / 0.3) ** 2 +
          pose.wave * (0.25 + u) * Math.sin(t * 1.7 + a.ph[1] - u * 5) +
          // closing and gliding in a fright, a quicker ripple runs down the arm toward the tip
          RIPPLE * O.shut * Math.min(1, 2 * O.fear) * u * u * Math.sin(t * 13 + a.ph[2] - u * 7);
        ang += k / N;
        x += Math.cos(ang) * seg;
        y += Math.sin(ang) * seg;
        T[j * 2] = x;
        T[j * 2 + 1] = y;
      }
      // the pose itself keeps each arm on its own side while it closes (see midline())
      const w = O.gather;
      if (w > 0)
        for (let j = 1; j <= N; j++) {
          const l = (T[j * 2] - O.x) * n0 + (T[j * 2 + 1] - O.y) * n1;
          const d = midline(a, j, l, w) - l;
          T[j * 2] += n0 * d;
          T[j * 2 + 1] += n1 * d;
        }
    }

    // Closing, the arms gather into a bundle behind the mantle, each on its own side of the
    // body's axis: a point nearing the midline is eased off it (no hard stop), and only the
    // last quarter of an arm may trail a little past it, the tip furthest. w blends it in
    // through the close and glide. l is a point's lateral offset from the axis; returns the
    // eased one.
    function midline(a, j, l, w) {
      const sg = a.s < 0 ? -1 : 1,
        u = j / N,
        mz = 0.08 * ML;
      const m0 = mz - (u > 0.76 ? (0.2 * ML * (u - 0.76)) / 0.24 : 0);
      const own = sg * l;
      if (own >= m0) return l;
      return l + (sg * (m0 - mz * Math.tanh((m0 - own) / mz)) - l) * w;
    }

    // Arms are verlet chains: water drag (far stronger across an arm than along it), a muscle
    // pull toward the pose that is strong at the root and weak at the tip, and fixed segment
    // lengths solved root-outward. Tips lag, trail and drag through the water on their own.
    // Past cruising pace the arms would flutter, or be held by still water and fling out on
    // every turn, so there the muscles damp them toward the pose's own motion, harder the
    // faster it goes, and so they do while scrolling turns it. Through the close and glide that
    // hold mostly lets go (LET_GO): the arms keep their own momentum, still water streams them
    // shut behind the body and a wave runs down to the tips, as at cruise. While fleeing or
    // scrolling, no point strays further from the
    // body's axis than REACH mantle lengths, however long the chase or the scroll: none opens
    // wider than the first ones. Past 90% of it a point is eased back, never stopped dead.
    const REACH = 2.25,
      REACH_IN = 3,
      LET_GO = 0.3,
      RIPPLE = 2.2,
      WHIP = 4.5,
      SIDE = 4;
    let walled = 0; // arm points held in at an edge, for the lab
    function stepArms(h, t) {
      const fast = Math.max(1, Math.hypot(O.vx, O.vy) / (80 * S)) ** 2;
      const hold = Math.max(
        // (only once the reach has closed in: the first stroke of a fright stays held)
        Math.min(1, h * 20 * (fast - 1)) * (1 - LET_GO * O.loose * O.grip ** 4),
        Math.min(1, h * 20 * O.sk),
      );
      const [f0, f1, n0, n1] = armFrame();
      const reach = ML * O.reach,
        soft = reach * 0.1,
        mw = O.gather,
        side = SIDE * ML * h,
        glass = 0.5 * ML,
        whip = WHIP * ML * h;
      for (const a of ARMS) {
        a.tp.set(a.t);
        armTarget(a, t);
        const { p, q, t: T, tp } = a;
        const seg = (a.len * AL) / N;
        p[0] = q[0] = T[0];
        p[1] = q[1] = T[1];
        for (let j = 1; j <= N; j++) {
          const o = j * 2,
            u = j / N;
          let vx = p[o] - q[o],
            vy = p[o + 1] - q[o + 1];
          let tx = p[o] - p[o - 2],
            ty = p[o + 1] - p[o - 1];
          const tl = Math.hypot(tx, ty) || 1;
          tx /= tl;
          ty /= tl;
          const vt = vx * tx + vy * ty;
          const dT = Math.max(0, 1 - h * 1.6),
            dN = Math.max(0, 1 - h * 7);
          vx = tx * vt * dT + (vx - tx * vt) * dN;
          vy = ty * vt * dT + (vy - ty * vt) * dN;
          vx -= (vx - (T[o] - tp[o])) * hold;
          vy -= (vy - (T[o + 1] - tp[o + 1])) * hold;
          // and no point ever outruns its pose by more than WHIP mantle lengths a second: a
          // thin tip can flutter, never crack like a whip
          const rx = vx - (T[o] - tp[o]),
            ry = vy - (T[o + 1] - tp[o + 1]),
            rl = Math.hypot(rx, ry);
          if (rl > whip) {
            vx -= rx * (1 - whip / rl);
            vy -= ry * (1 - whip / rl);
          }
          const K = 520 * (1 - u) * (1 - u) + 11;
          q[o] = p[o];
          q[o + 1] = p[o + 1];
          p[o] += vx + (T[o] - p[o]) * K * h * h;
          p[o + 1] += vy + (T[o + 1] - p[o + 1]) * K * h * h;
          // closing, a point that has strayed across the axis is eased back to its own side, at
          // most SIDE mantle lengths a second each: each point by itself, so the corrections
          // never add up down the arm into a flick at the tip
          if (mw > 0) {
            const l = (p[o] - O.x) * n0 + (p[o + 1] - O.y) * n1;
            const d = clamp(midline(a, j, l, mw) - l, -side, side);
            if (d !== 0) {
              p[o] += n0 * d;
              p[o + 1] += n1 * d;
              q[o] += n0 * d * 0.5;
              q[o + 1] += n1 * d * 0.5;
            }
          }
          // an arm point close to an edge of the screen is eased away from it, like an arm
          // feeling the glass, at most SIDE mantle lengths a second
          const ex = clamp(glass - p[o], 0, side) - clamp(p[o] - (W - glass), 0, side),
            ey = clamp(glass - p[o + 1], 0, side) - clamp(p[o + 1] - (H - glass), 0, side);
          if (ex || ey) {
            p[o] += ex;
            p[o + 1] += ey;
            q[o] += ex * 0.5;
            q[o + 1] += ey * 0.5;
          }
        }
        // fixed lengths, no joint bends sharper than a real arm can, and within reach of the
        // axis: a segment that would cross it swings back about its joint, keeping its length
        // which way along the body a clamped segment points: as it points, unless it lies
        // nearly across the axis, where that can flip in a frame; then as it pointed last step
        const back = (db, o) =>
          Math.abs(db) > seg * 0.3
            ? Math.sign(db)
            : (q[o] - q[o - 2]) * f0 + (q[o + 1] - q[o - 1]) * f1 < 0
              ? -1
              : 1;
        let pa = Math.atan2(p[3] - p[1], p[2] - p[0]);
        for (let j = 1; j <= N; j++) {
          const o = j * 2;
          let ang = Math.atan2(p[o + 1] - p[o - 1], p[o] - p[o - 2]);
          if (j > 1) {
            // ...though a tip may curl tighter, so the last joints are not all held at the
            // limit at once and swung round together in a flick
            const lim = 0.42 + 0.4 * (j / N) ** 3;
            ang = pa + clamp(wrapA(ang - pa), -lim, lim);
          }
          let dx = Math.cos(ang) * seg,
            dy = Math.sin(ang) * seg;
          const lp = (p[o - 2] - O.x) * n0 + (p[o - 1] - O.y) * n1;
          let dl = dx * n0 + dy * n1;
          const L = Math.abs(lp + dl);
          if (L > reach - soft) {
            const db = dx * f0 + dy * f1;
            const to = reach - soft + soft * Math.tanh((L - reach + soft) / soft);
            dl = Math.sign(lp + dl) * to - lp;
            const b = back(db, o) * Math.sqrt(Math.max(0, seg * seg - dl * dl));
            dx = f0 * b + n0 * dl;
            dy = f1 * b + n1 * dl;
            ang = Math.atan2(dy, dx);
          }
          p[o] = p[o - 2] + dx;
          p[o + 1] = p[o - 1] + dy;
          pa = ang;
          // last resort: no arm ever reaches out of the screen; one that would lies along its edge
          if (p[o] < 1 || p[o] > W - 1 || p[o + 1] < 1 || p[o + 1] > H - 1) {
            p[o] = clamp(p[o], 1, W - 1);
            p[o + 1] = clamp(p[o + 1], 1, H - 1);
            walled++;
          }
        }
      }
    }

    // --- where to go ----------------------------------------------------------------------
    // It roams the whole viewport, behind the text too (the page's panels keep that readable).
    // A coverage memory remembers where it has been lately, and new waypoints favour the
    // places it has not, so over a minute or so it visits every part of the screen. Open
    // overlays (the tune panel, anything marked data-sea-avoid) are places not to linger in.
    const GX = 6,
      GY = 4,
      visits = new Float32Array(GX * GY);
    const cellOf = (x, y) =>
      clamp(Math.floor((y / H) * GY), 0, GY - 1) * GX + clamp(Math.floor((x / W) * GX), 0, GX - 1);
    function remember(dt) {
      const k = Math.exp(-dt / 45);
      for (let i = 0; i < visits.length; i++) visits[i] *= k;
      visits[cellOf(O.x, O.y)] += dt;
    }
    // the open overlays' rects, read from the page once a second
    let avoid = [],
      avoidAge = 1;
    function overlays(dt) {
      if ((avoidAge += dt) < 1) return;
      avoidAge = 0;
      avoid = [];
      for (const el of document.querySelectorAll("#tune, [data-sea-avoid]")) {
        if (el.hidden) continue;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) avoid.push(r);
      }
    }
    // how far (x, y) is inside an open overlay, padded by a mantle length; 0 when clear
    function behind(x, y) {
      let v = 0;
      for (const r of avoid) {
        const p = ML;
        const d = Math.min(x - r.left + p, r.right + p - x, y - r.top + p, r.bottom + p - y);
        if (d > 0) v = Math.max(v, d);
      }
      return v;
    }
    // A spot's appeal: well inside the screen, not behind an overlay, little visited lately,
    // and only mildly, off the text column.
    function appeal(x, y) {
      const m = (FREE + PAD + 0.5) * ML;
      let v = 0;
      v -= Math.max(0, m - x, x - (W - m)) / 40;
      v -= Math.max(0, m - y, y - (H - m)) / 40;
      if (band && x > colL && x < colR) v -= 0.25;
      v -= behind(x, y) > 0 ? 3 : 0;
      let mean = 0;
      for (let i = 0; i < visits.length; i++) mean += visits[i];
      mean /= visits.length;
      v -= (0.9 * visits[cellOf(x, y)]) / (mean + 0.5);
      return v;
    }
    function pickWaypoint() {
      let best = -1e9;
      for (let i = 0; i < 28; i++) {
        const x = rnd(0, W),
          y = rnd(0, H);
        const d = Math.hypot(x - O.x, y - O.y);
        const dir = Math.atan2(y - O.y, x - O.x);
        const ahead = Math.cos(wrapA(dir - O.th));
        const sc =
          appeal(x, y) -
          Math.abs(d - 320 * S) / (300 * S) +
          ahead * 0.4 -
          Math.max(0, Math.sin(dir) - 0.3) * 1.2 +
          random() * 0.6;
        if (sc > best) {
          best = sc;
          O.wx = x;
          O.wy = y;
        }
      }
      O.wpAge = 0;
    }

    // --- staying in view ---------------------------------------------------------------------
    // No part of it ever leaves the screen. ext is how far the body reaches from the neck
    // toward each side (px: the arms, the mantle and the head, measured every frame), and
    // ext.ax/ay where its arm tips are on average. Steering keeps clear of the edges by that
    // much plus PAD (see room(), desiredHeading()); a stroke that would carry it out is
    // softened; and as a last resort the water slows its way outward (never a push back).
    const ext = { l: 0, r: 0, t: 0, b: 0, ax: 0, ay: 0 };
    const PAD = 0.25; // mantle lengths
    function measure() {
      const f0 = Math.cos(O.th),
        f1 = Math.sin(O.th);
      let x0 = O.x,
        x1 = O.x,
        y0 = O.y,
        y1 = O.y,
        ax = 0,
        ay = 0;
      for (const a of ARMS) {
        const p = a.p;
        for (let j = 0; j < p.length; j += 2) {
          if (p[j] < x0) x0 = p[j];
          if (p[j] > x1) x1 = p[j];
          if (p[j + 1] < y0) y0 = p[j + 1];
          if (p[j + 1] > y1) y1 = p[j + 1];
        }
        ax += p[p.length - 2] - O.x;
        ay += p[p.length - 1] - O.y;
      }
      // the mantle's tip ahead, the crown of the head behind, the neck's width either side
      for (const [u, v] of [
        [1.45, 0],
        [-0.5, 0],
        [0, 0.55],
        [0, -0.55],
      ]) {
        const x = O.x + (f0 * u - f1 * v) * ML,
          y = O.y + (f1 * u + f0 * v) * ML;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      ext.l = O.x - x0;
      ext.r = x1 - O.x;
      ext.t = O.y - y0;
      ext.b = y1 - O.y;
      ext.ax = ax / ARMS.length;
      ext.ay = ay / ARMS.length;
    }
    // The margin it keeps from an edge: room for its arms to swing round as it turns (FREE
    // mantle lengths), or as far as the body reaches that way now (e), if that is further.
    const FREE = 3;
    function reachTo(_a, _nx, _ny, e) {
      return Math.max(e, FREE * ML) + PAD * ML;
    }
    // Which way is inward, and how urgently: each edge closer to the neck than FREE + 1 mantle
    // lengths pushes, harder the closer it is. Returns [x, y] (0 when clear of them all).
    function inward() {
      const z = (FREE + 1) * ML,
        k = (d) => clamp((z - d) / (1.5 * ML), 0, 1);
      return [k(O.x) - k(W - O.x), k(O.y) - k(H - O.y)];
    }
    // How far the body is from each edge now (px, PAD already taken off)
    function clearance() {
      const p = PAD * ML;
      return {
        l: O.x - ext.l - p,
        r: W - O.x - ext.r - p,
        t: O.y - ext.t - p,
        b: H - O.y - ext.b - p,
      };
    }
    // After a resize the screen may no longer hold it where it was: the whole animal shifts in
    // at once, with the page that reflowed around it (it never swims back in through an edge).
    function fit() {
      measure();
      const p = PAD * ML;
      const shift = (lo, hi) => (lo > hi ? (lo + hi) / 2 : clamp(0, lo, hi));
      const dx = shift(ext.l + p - O.x, W - ext.r - p - O.x),
        dy = shift(ext.t + p - O.y, H - ext.b - p - O.y);
      if (!dx && !dy) return;
      O.x += dx;
      O.y += dy;
      for (const a of ARMS)
        for (const b of [a.p, a.q, a.t, a.tp])
          for (let j = 0; j < b.length; j += 2) {
            b[j] += dx;
            b[j + 1] += dy;
          }
      measure();
    }

    // Where it wants to head, unhurried: toward its waypoint, along a meandering path, and
    // away from an edge it is nearing. It never bounces off an edge: well before one it begins
    // a smooth curved turn toward the side with more room, harder the closer it gets.
    function desiredHeading(dt) {
      let dx = O.wx - O.x,
        dy = O.wy - O.y;
      const d = Math.hypot(dx, dy) || 1;
      dx /= d;
      dy /= d;
      O.wander = clamp(O.wander + (random() - 0.5) * dt * 1.6, -0.5, 0.5);
      // the path meanders: a slow weave whose pace and sweep drift too, so no two legs match
      O.weave += dt * (0.5 + 0.35 * Math.sin(O.weave * 0.27 + 1));
      const sway = 0.38 * Math.sin(O.weave) * (0.6 + 0.4 * Math.sin(O.weave * 0.41));
      let want = Math.atan2(dy, dx) + O.wander * 0.6 + sway;
      // it looks ahead as far as it needs to come about at its speed (a turn's radius at its
      // turn rate) plus a margin, and turns early toward the side with more room
      // close to an edge (ahead, beside or behind) it bends its way inward
      const [ix, iy] = inward(),
        ik = Math.min(1, Math.hypot(ix, iy));
      if (ik > 0) want += wrapA(Math.atan2(iy, ix) - want) * ik * 0.7;
      const look = edgeLook();
      const r0 = room(O.th);
      O.edgeK = r0 < look ? 1 - r0 / look : 0;
      if (O.edgeK > 0) {
        const k = O.edgeK;
        // which way has more room, looking well round; toward the middle of the screen breaks
        // a tie, so it never turns into a corner
        const cx = W / 2 - O.x,
          cy = H / 2 - O.y,
          side = (g) =>
            room(O.th + g * 0.9) +
            room(O.th + g * 1.6) * 0.5 +
            (Math.cos(O.th + g * 0.9) * cx + Math.sin(O.th + g * 0.9) * cy) * 0.15;
        const rl = side(-1),
          rr = side(1);
        // keep turning the way it began unless the other way is clearly roomier
        if (!O.edgeSide || (O.edgeSide > 0 ? rl > rr * 1.4 + ML : rr > rl * 1.4 + ML))
          O.edgeSide = rr >= rl ? 1 : -1;
        const away = O.th + O.edgeSide * (0.6 + 1.6 * k);
        want += wrapA(away - want) * Math.min(1, 1.8 * k);
      } else O.edgeSide = 0;
      return want;
    }

    // how far ahead it watches for an edge: a margin, the radius of a turn at its speed, and the
    // way it would coast meanwhile
    function edgeLook() {
      const v = Math.max(0, O.vx * Math.cos(O.th) + O.vy * Math.sin(O.th));
      return ML * 1.5 + v / 1.1 + v / 2.5;
    }

    // --- the world around it ----------------------------------------------------------------
    const wake = [];
    const snow = Array.from({ length: 46 }, () => ({
      x: random() * 2000,
      y: random() * 1400,
      vx: 0,
      vy: 0,
      v: rnd(2, 7),
      ch: random() < 0.7 ? "." : "·",
    }));

    function siphon() {
      // the funnel opens just behind the mantle on the near side, pointing back
      const [f0, f1, n0, n1] = frame0();
      return [O.x - f0 * ML * 0.1 + n0 * MW * 0.42, O.y - f1 * ML * 0.1 + n1 * MW * 0.42];
    }

    // How long it coasts between bouts: mostly a short pause before a quick burst, often a
    // longer glide, now and then a slow hover. Each kind is exponential above a floor, capped,
    // and the whole never runs past REST_MAX: it never parks.
    const REST_MAX = 2.4;
    function restLength() {
      const u = random(),
        ex = (floor, mean, cap) => Math.min(cap, floor - mean * Math.log(1 - random()));
      let r;
      if (u < 0.5) {
        O.burst = random() < 0.6 ? 2 : 3;
        r = ex(0.15, 0.65, 1.8);
      } else {
        O.burst = Math.round(rnd(2, 4));
        r = u < 0.88 ? ex(1, 0.6, 2.8) : ex(2.2, 0.5, 3.4);
      }
      return Math.min(REST_MAX, r / Math.sqrt(Math.max(0.3, tune.speed)));
    }

    // Between bouts an arm now and then reaches out on its own: it straightens and swings out a
    // little, feeling about, and its tip curls into a spiral as it is drawn back in. One arm at
    // a time, never while swimming.
    let exploreIn = 1;
    function explore(dt) {
      const calm = O.mode === "drift" && !O.hurry && O.fear < 0.05;
      exploreIn -= dt;
      if (calm && exploreIn <= 0 && !ARMS.some((a) => a.exT >= 0)) {
        const a = ARMS[Math.floor(random() * ARMS.length)];
        a.exT = 0;
        a.exD = rnd(1.6, 2.6);
        exploreIn = rnd(1.2, 3.5);
      }
      for (const a of ARMS) {
        if (a.exT >= 0) {
          a.exT += dt / a.exD;
          if (a.exT >= 1 || !calm) a.exT = -1;
        }
        a.ex = approach(a.ex, a.exT >= 0 ? Math.sin(Math.PI * a.exT) : 0, 2.5, dt);
      }
    }

    function update(dt, t) {
      const x0 = O.x,
        y0 = O.y,
        th0 = O.th;
      O.wpAge += dt;
      remember(dt);
      overlays(dt);
      pressure(dt);
      scrolled(dt);
      O.grip = approach(O.grip, Math.max(O.hurry ? 1 : 0, O.sk), 6, dt);
      // the reach (mantle lengths) closes in as the grip firms, but never faster than
      // REACH_IN a second, so an arm caught wide is drawn in, not snatched
      const reachT = REACH + 4 * (1 - O.grip);
      O.reach = reachT > O.reach ? reachT : Math.max(reachT, O.reach - REACH_IN * dt);
      if (!O.hurry && (Math.hypot(O.wx - O.x, O.wy - O.y) < 80 * S || O.wpAge > 16)) pickWaypoint();
      // behind an open overlay it does not rest long
      if (O.mode === "drift" && !O.hurry && behind(O.x, O.y) > 0) O.rest = Math.min(O.rest, 0.3);
      const toWaypoint = O.hurry ? 0 : desiredHeading(dt);
      let want = O.hurry ? O.fleeA : toWaypoint;
      if (O.hurry) {
        const [ix, iy] = inward(),
          ik = Math.min(1, Math.hypot(ix, iy));
        if (ik > 0) want += wrapA(Math.atan2(iy, ix) - want) * ik * 0.5;
      }
      // unhurried, it never sets off or coasts mantle-first steeply downward: a waypoint below
      // is reached on a shallow descent
      // (straight down, it keeps to the side it already faces, so the choice can't flicker)
      if (!O.hurry && Math.sin(want) > 0.45) {
        const c = Math.abs(Math.cos(want)) < 0.3 ? Math.cos(O.th) : Math.cos(want);
        want = c >= 0 ? Math.asin(0.45) : Math.PI - Math.asin(0.45);
      }
      let turnRate;

      // Stroke cycle: a quick jet (the mantle squeezes, the arms snap shut and stream behind),
      // then a slow refill as the mantle swells and the arms flare open like an umbrella.
      let spreadT,
        curlT,
        relaxT,
        waveT,
        squeezeT = 0;
      power = 0;
      if (O.mode === "swim") {
        O.phase += dt / O.period;
        if (O.phase >= 1) {
          O.phase -= 1;
          if (O.settle) calm();
          // fleeing, each stroke takes its length from the fear when it begins
          if (O.hurry) O.period = fleePeriod();
          // no two strokes of a bout quite alike
          if (!O.hurry) {
            O.thrust = rnd(0.85, 1.15);
            O.period = O.style === "web" ? rnd(2, 2.6) : rnd(1.4, 1.8);
          }
          // a hurrying octopus keeps stroking until it gets there
          if (!O.hurry && --O.strokes <= 0) {
            O.mode = "drift";
            O.rest = restLength();
            O.thrust = 1;
            O.period = 1.6;
          }
        }
        const p = O.phase;
        // A web pulse is the slow, medusoid stroke: the arms and the web billow open wider, like
        // an umbrella, and pulse half shut, pushing gently; the mantle hardly squeezes.
        const web = O.style === "web" && !O.hurry,
          wk = web ? 0.5 : 1;
        // Fleeing is jet propulsion, not flapping: fear never quickens the stroke, it makes each
        // one a single harder jet (a quicker snap into a tighter bundle, a bigger push, see
        // fleePeriod()) and a longer streamlined glide after it. Inhale... JET... long coast.
        // (The pose opens a little less as fear rises, so no stroke of a long chase opens wider
        // than the first.)
        const fear = O.hurry ? O.fear : 0;
        const flare = web ? 0.8 : O.hurry ? 0.64 - 0.22 * fear : 0.62;
        const pc = (O.pc = O.hurry ? (0.32 - 0.05 * fear) / O.period : web ? 0.42 : 0.28);
        const shutT = web ? 0.34 : -0.08 - 0.06 * fear;
        if (p < pc) {
          const u = p / pc;
          power = Math.sin(u * Math.PI) * (0.28 / pc) * (web ? 0.75 : 1);
          O.shut = ease(Math.min(1, u * 2.5));
          // the arms stay held until they are well on their way in, off the reach, so none
          // springs loose from where the reach held it bent
          O.loose = ease(clamp((u - 0.35) / 0.45, 0, 1));
          spreadT = flare + (shutT - flare) * ease(Math.min(1, u * 1.4));
          curlT = web ? 0.45 : 0.15;
          squeezeT = Math.sin(u * Math.PI * 0.5) * wk;
        } else {
          // it coasts shut a moment, streamlined, then draws in water for the next jet; fleeing,
          // for most of what is left of the stroke, the longer the more frightened
          const g = O.hurry ? 0.5 + 0.2 * fear : web ? 0 : 0.18,
            u = Math.max(0, (p - pc) / (1 - pc) - g) / (1 - g);
          const open = ease(Math.min(1, u * (O.hurry ? 1.5 : 1.15)));
          O.shut = O.loose = 1 - open;
          spreadT = shutT + (flare - shutT) * open;
          curlT = 0.25 + 0.55 * u;
          squeezeT = (Math.cos(u * Math.PI * 0.5) - 0.45 * Math.sin(u * Math.PI)) * wk;
        }
        relaxT = web ? 0.2 : 0;
        // coasting after a frightened jet only the tips ripple
        waveT = web ? 0.5 : O.hurry ? 0.35 - 0.2 * O.shut : 0.35;
        turnRate = (p < pc ? 0.45 : 0.95) * (O.hurry ? 1.3 : 1);
      } else {
        // drifting: slow breathing, the web half open, every arm tip doing its own thing
        O.rest -= dt;
        O.shut = O.loose = 0;
        const open = 0.5 + 0.5 * Math.sin(t * 0.13 + 1);
        spreadT = 0.55 + 0.35 * open;
        curlT = 1;
        relaxT = 1;
        waveT = 0.55;
        squeezeT = 0.12 * Math.sin(t * 2.4);
        turnRate = O.hurry ? 1.3 : 0.42;
        // hanging in the water the mantle floats up; it only lines up with where it is going
        // in the moment before it sets off
        if (O.rest > 1.5) {
          const up = -Math.PI / 2;
          want = up + clamp(wrapA(O.th - up), -0.7, 0.7) * 0.9;
        }
        // ...unless that would face it into the edge: then it hangs level, a little nose-up,
        // toward the side its waypoint is on (never mantle-down, resting upside down)
        if (!O.hurry && offside(want) > 0.25) want = O.wx >= O.x ? -0.25 : Math.PI + 0.25;
        // in the moment before it sets off it lines up quicker, and it sets off within half a
        // second whether lined up or not: it finishes the turn on the stroke
        if (O.rest < 0.6) turnRate = Math.max(turnRate, 0.85);
        // (startled, it draws its arms to their sides for a beat before the first jet)
        if (
          O.rest < 0 &&
          (!O.hurry || O.gather > 0.6) &&
          (Math.abs(wrapA(want - O.th)) < (O.hurry ? (room(O.th) > 150 * S ? 1.6 : 0.5) : 0.8) ||
            O.rest < -0.5)
        ) {
          O.mode = "swim";
          O.phase = 0;
          O.strokes = O.burst;
          // unhurried, about one bout in three is web pulses rather than jetting
          O.style = !O.hurry && random() < 0.35 ? "web" : "jet";
          if (!O.hurry) {
            O.period = O.style === "web" ? rnd(2, 2.6) : rnd(1.4, 1.8);
            O.thrust = rnd(0.85, 1.15);
          }
        }
      }
      // the arms gather onto their own sides through the close and glide, and already in the
      // moment before a stroke, or while something looms, so none starts the close across the
      // axis
      O.gather =
        O.mode === "swim"
          ? Math.max(O.shut, approach(O.gather, O.shut, 3, dt))
          : approach(
              O.gather,
              O.rest < 0.8 || O.fear > 0.15 || O.hurry ? 1 : 0,
              O.hurry ? 8 : 3,
              dt,
            );
      // unhurried, it rights itself from mantle-down briskly, on a stroke or between them, and
      // between them it turns as briskly from an edge close ahead
      if (!O.hurry && (Math.sin(O.th) > 0.45 || (O.mode === "drift" && offside(O.th) > 0.25)))
        turnRate = Math.max(turnRate, 1.3);
      // nearing an edge it comes about briskly, the more so the closer it gets
      const edgeK = O.hurry ? Math.max(0, 1 - room(O.th) / edgeLook()) : O.edgeK;
      if (edgeK > 0) turnRate = Math.max(turnRate, 0.7 + 0.9 * edgeK);
      const spreadRate =
        O.mode === "swim"
          ? O.style === "web" && !O.hurry
            ? 7
            : 14 * (1 + (O.hurry ? 0.5 * O.fear : 0))
          : 2.5;
      pose.spread = approach(pose.spread, spreadT, spreadRate, dt);
      // each arm follows the stroke at its own pace, a little ahead or behind the rest
      for (const a of ARMS) a.sp = approach(a.sp, spreadT, spreadRate * a.rate, dt);
      explore(dt);
      pose.curl = approach(pose.curl, curlT, 3, dt);
      pose.relax = approach(pose.relax, relaxT, O.mode === "swim" ? 4 : 0.8, dt);
      pose.wave = approach(pose.wave, waveT, 2, dt);
      pose.squeeze = approach(pose.squeeze, squeezeT, 16, dt);
      // the soft mantle sags and sways behind the head when not driven
      pose.tilt = approach(pose.tilt, pose.relax * 0.16 * Math.sin(t * 0.5), 2, dt);

      // turning, smoothed so the heading never snaps; while scrolling turns it, it barely steers
      // against that, and afterwards it eases back the ordinary way
      turnRate *= 1 - 0.75 * O.sk;
      let diff = wrapA(want - O.th);
      // unhurried, it comes about over the top, never rolling through mantle-down on the way
      const toDown = wrapA(Math.PI / 2 - O.th);
      if (!O.hurry && toDown * diff > 0 && Math.abs(toDown) < Math.abs(diff))
        diff -= Math.sign(diff) * 2 * Math.PI;
      O.w = approach(O.w, clamp(diff * 2, -turnRate, turnRate), 2.6, dt);
      O.th += (O.w + O.ws) * dt;
      // the bend follows the turn rate (steering, scrolling or fleeing alike), eased in and out;
      // saturating, so the sharpest turns bend it some 15 degrees
      const arch0 = O.arch;
      O.arch = approach(O.arch, ARCH * Math.tanh(0.85 * (O.w + O.ws)), 3, dt);

      // the jet pushes the mantle forward; the water slows everything down
      const f0 = Math.cos(O.th),
        f1 = Math.sin(O.th);
      // a stroke never drives it out of the screen: with less room ahead than it would coast,
      // the push fades (the arms still pulse; the stroke turns it rather than carries it)
      const vf0 = O.vx * f0 + O.vy * f1,
        roomAhead = room(O.th);
      const gate = clamp((roomAhead - Math.max(0, vf0) / 1.25) / (1.5 * ML), 0, 1);
      const acc = power * 340 * S * O.thrust * (O.hurry ? 1 : tune.speed) * gate;
      O.vx += f0 * acc * dt;
      O.vy += f1 * acc * dt;
      // a streamlined body: it slips forward easily, sideways hardly at all
      const sp = Math.hypot(O.vx, O.vy);
      const vf = O.vx * f0 + O.vy * f1;
      const vl = -O.vx * f1 + O.vy * f0;
      // fleeing, it holds the streamlined glide longer, so each stroke carries it further
      const dF = (1.25 + (sp * 0.004) / S) * (O.hurry ? 1 - GLIDE * O.fear * O.shut : 1),
        dL = 4;
      const nf = vf * Math.max(0, 1 - dF * dt),
        nl = vl * Math.max(0, 1 - dL * dt);
      O.vx = f0 * nf - f1 * nl;
      O.vy = f1 * nf + f0 * nl;
      if (O.mode === "drift") {
        O.vy += (5 * S - O.vy) * 0.3 * dt; // slowly sinks
        // ...and never parks: the mantle's breathing pushes it gently on, in soft pulses, a
        // drift of some half a mantle length a second, less with an edge close ahead
        const room0 = gate * Math.min(1, roomAhead / (150 * S));
        const pulse = (1 + 0.7 * Math.cos(t * 2.4)) * (0.8 + 0.3 * Math.sin(t * 0.37 + 2));
        const da = DRIFT * ML * pulse * room0 * dt;
        O.vx += f0 * da;
        O.vy += f1 * da;
      }
      // Last resort: wherever it would coast past an edge before the water stops it, the water
      // there slows its way outward just enough, gradually; nothing is ever reflected or pushed
      // back (steering turns it away, see desiredHeading())
      const cl = clearance();
      const brake = (v, c) =>
        v <= 0 ? v : v * Math.max(0, 1 - Math.max(0, v / Math.max(c - 0.3 * ML, 0.5) - 1.25) * dt);
      O.vx = O.vx < 0 ? -brake(-O.vx, cl.l) : brake(O.vx, cl.r);
      O.vy = O.vy < 0 ? -brake(-O.vy, cl.t) : brake(O.vy, cl.b);
      O.x += O.vx * dt;
      O.y += O.vy * dt;

      // scrolling only drifts the marine snow a little; the animal itself just turns
      const fy = -O.sv * 0.06 * dt;

      // the arms step at 100Hz with the body moved smoothly between frames, so no arm point is
      // handed a whole frame's travel in one substep
      const steps = Math.max(1, Math.ceil(dt / (1 / 100)));
      const x1 = O.x,
        y1 = O.y,
        th1 = O.th,
        arch1 = O.arch;
      for (let i = 0; i < steps; i++) {
        const k = (i + 1) / steps;
        O.x = x0 + (x1 - x0) * k;
        O.y = y0 + (y1 - y0) * k;
        O.th = th0 + (th1 - th0) * k;
        O.arch = arch0 + (arch1 - arch0) * k;
        stepArms(dt / steps, t - dt + k * dt);
      }
      measure();

      // jet water: faint specks and stirred marine snow behind the funnel
      const [jx, jy] = siphon();
      if (power > 0.3 && random() < dt * 26 * O.thrust)
        wake.push({
          x: jx,
          y: jy,
          vx: -f0 * rnd(60, 130) * O.thrust + rnd(-15, 15),
          vy: -f1 * rnd(60, 130) * O.thrust + rnd(-15, 15),
          life: rnd(0.5, 0.9),
        });
      for (const b of wake) {
        b.x += b.vx * dt;
        b.y += b.vy * dt + fy;
        b.vx *= 1 - dt * 3;
        b.vy *= 1 - dt * 3;
        b.life -= dt;
      }
      for (let i = wake.length - 1; i >= 0; i--) if (wake[i].life <= 0) wake.splice(i, 1);
      for (const s of snow) {
        if (power > 0.3) {
          const dx = s.x - jx,
            dy = s.y - jy;
          const d = Math.hypot(dx, dy);
          if (d < 90 * S && dx * -f0 + dy * -f1 > d * 0.6) {
            const k = (1 - d / (90 * S)) * power * 260 * O.thrust * dt;
            s.vx -= f0 * k;
            s.vy -= f1 * k;
          }
        }
        s.x += s.vx * dt;
        s.y += (s.v + s.vy) * dt + fy * 0.6;
        s.vx *= 1 - dt * 1.8;
        s.vy *= 1 - dt * 1.8;
        s.x = (s.x + W) % W;
        s.y = (s.y + H) % H;
      }
    }

    // --- scrolling ---------------------------------------------------------------------------
    // Scrolling turns the animal, in proportion to how far the page moves: down turns it one way,
    // up the other. It never drags or pushes the body, the signal is low-passed so nothing
    // snaps, the turn rate is capped, and a turn that would face it out of the screen or
    // upside down (mantle leading downward) fades out before it gets there.
    let scrollAcc = 0;
    function scrolled(dt) {
      const raw = dt > 0 ? clamp(scrollAcc / dt, -8000, 8000) : 0;
      scrollAcc = 0;
      O.sv = approach(O.sv, raw, 2.5, dt);
      if (Math.abs(O.sv) < 1) O.sv = 0;
      const k = Math.min(1, Math.abs(O.sv) / 250);
      O.sk = approach(O.sk, k, k > O.sk ? 6 : 1.2, dt);
      let ws = clamp(O.sv * 0.0016 * tune.scroll, -0.7, 0.7) * (O.hurry ? 0.5 : 1);
      // only ever turn away from trouble, never into it
      const ahead = O.th + Math.sign(ws) * 0.35;
      const worse = offside(ahead) - offside(O.th);
      if (worse > 0) ws *= clamp(1 - offside(ahead) * 3, 0, 1);
      // ...nor swing its trailing arms into an edge close beside them
      const cl = clearance(),
        sx = -ext.ay * Math.sign(ws),
        sy = ext.ax * Math.sign(ws);
      const near = Math.min(
        sx < 0 ? cl.l : sx > 0 ? cl.r : Infinity,
        sy < 0 ? cl.t : sy > 0 ? cl.b : Infinity,
      );
      ws *= clamp(near / (1.5 * ML), 0, 1);
      O.ws = approach(O.ws, ws, 4, dt);
    }

    // 0 for a heading into open water, rising as it points upside down (mantle leading more
    // than ~35° below level) or at a screen edge close ahead
    function offside(a) {
      return Math.max(0, Math.sin(a) - 0.55) * 2 + Math.max(0, 1 - room(a) / (160 * S));
    }

    // --- fleeing the pointer -------------------------------------------------------------------
    // Pressure builds while the pointer stays close, faster when it closes in or follows, and
    // fades once it leaves. Close enough and the octopus flees straight away from it, with its
    // ordinary jet cycle quicker, pushing harder and gliding further the more pressure there is.
    const THRUST = 1,
      GLIDE = 0.4,
      DRIFT = 0.75; // mantle lengths/s², the push of its breathing while it coasts
    let ptr = null,
      lastD = Infinity,
      closing = 0;
    const NEAR = () => 230 * S * tune.react;

    // how far the animal can swim at angle a before reaching the screen margin
    // (the margin at each edge is the whole body's reach toward it once headed this way, see
    // reachTo(), so it is the room before any part of it would leave the screen)
    function room(a) {
      const c = Math.cos(a),
        s = Math.sin(a);
      let r = 420 * S;
      if (c > 1e-3) r = Math.min(r, (W - reachTo(a, 1, 0, ext.r) - O.x) / c);
      if (c < -1e-3) r = Math.min(r, (reachTo(a, -1, 0, ext.l) - O.x) / c);
      if (s > 1e-3) r = Math.min(r, (H - reachTo(a, 0, 1, ext.b) - O.y) / s);
      if (s < -1e-3) r = Math.min(r, (reachTo(a, 0, -1, ext.t) - O.y) / s);
      return Math.max(0, r);
    }

    // straight away from the pointer, unless a border is in the way: then whichever way along
    // it leaves the most room. The text column is only a mild preference.
    function fleeHeading(px, py) {
      const away = Math.atan2(O.y - py, O.x - px);
      let best = -1e9,
        bestA = away;
      for (let k = -12; k <= 12; k++) {
        const a = away + k * 0.2;
        const r = room(a);
        const ex = O.x + Math.cos(a) * r;
        let sc = (r / (420 * S)) * 2 + Math.cos(a - away) - Math.max(0, 1 - r / (200 * S)) * 2.5;
        if (band && ex > colL - 40 && ex < colR + 40) sc -= 0.25;
        sc -= Math.abs(wrapA(a - O.fleeA)) * 0.1; // don't flicker between equal choices
        if (sc > best) {
          best = sc;
          bestA = a;
        }
      }
      return bestA;
    }

    function pressure(dt) {
      const d = ptr ? Math.hypot(ptr.x - O.x, ptr.y - O.y) : Infinity;
      const R = NEAR();
      const rawClose = d < R && lastD < R ? clamp((lastD - d) / dt / (300 * S), -1, 1) : 0;
      closing = approach(closing, rawClose, 5, dt);
      lastD = d;
      if (d < R) {
        O.fear = Math.min(
          1,
          O.fear + dt * (0.06 + 0.16 * (1 - d / R) + 0.3 * Math.max(0, closing)),
        );
        if (!O.hurry && d < 140 * S * tune.react) startFlee(1.5);
      } else O.fear = Math.max(0, O.fear - dt * 0.3);

      if (!O.hurry) return;
      O.fleeMin -= dt;
      if (ptr) O.fleeA += wrapA(fleeHeading(ptr.x, ptr.y) - O.fleeA) * Math.min(1, dt * 5);
      // fear makes each stroke push harder and glide further (and the next one wait for it); it
      // never quickens the stroke or opens the arms wider (see REACH)
      O.thrust = 1.7 + THRUST * O.fear;
      if (d > R * 1.15 && O.fear < 0.25 && O.fleeMin <= 0) {
        // safe: finish this stroke as it began and settle down (see calm())
        if (O.mode === "drift") calm();
        else O.settle = true;
      }
    }

    // a frightened stroke: the more fear, the longer, so strokes come no faster as it rises
    const fleePeriod = () => 1.5 + 0.7 * O.fear;

    // the fright is over: one more stroke at ease, two to right itself on if it fled
    // mantle-down, then the ordinary rest
    function calm() {
      O.hurry = O.settle = false;
      O.strokes = Math.sin(O.th) > 0.45 ? 2 : 1;
      O.thrust = 1;
      O.period = rnd(1.4, 1.8);
      pickWaypoint();
    }

    function startFlee(min) {
      if (!running) return;
      O.fleeMin = Math.max(O.fleeMin, min);
      O.settle = false;
      if (O.hurry) return;
      O.hurry = true;
      O.style = "jet";
      O.period = fleePeriod();
      O.fleeA = ptr ? Math.atan2(O.y - ptr.y, O.x - ptr.x) : O.th;
      if (O.mode === "drift") O.rest = 0;
    }

    // --- drawing ----------------------------------------------------------------------------
    // The animal is drawn as a grey-level shading field (sx: brightness, with coverage in its
    // alpha) and a pale pattern (px: suckers, papillae), which the painters below sample into
    // cells. The anatomy, after swimming footage: a soft, bag-like mantle that tapers to a
    // rounded point and squeezes and swells with each jet; a narrower head below it, with the
    // eyes as low bumps on its sides; eight arms, thick at the root and tapering to fine tips,
    // joined near the root by a web.
    const g = (v, a = 1) => `rgba(${v * 255},${v * 255},${v * 255},${a})`;
    const LIGHT = [-0.45, -0.89];
    // thick and muscular at the root, very fine at the tip; streaming shut behind a jet, the
    // arms stretch thinner past the web, so each still shows apart from its neighbours. The
    // far arms, across the body, look a little slimmer.
    let armK = 1;
    const armWidth = (u) =>
      (MW * 0.32 * (1 - u) ** 1.8 * (1 - 0.6 * O.shut * clamp((u - 0.1) / 0.2, 0, 1)) + 0.6 * S) *
      armK;

    function drawArm(a, lvl, highlight) {
      const p = a.p;
      sx.lineCap = "round";
      for (let j = 0; j < N; j++) {
        // the root is skin like the head's, the arm darkening a little toward the tip
        const u = j / N;
        sx.strokeStyle = g(lvl + (0.74 - lvl) * Math.max(0, 1 - u / 0.4));
        sx.lineWidth = armWidth(u);
        sx.beginPath();
        sx.moveTo(p[j * 2], p[j * 2 + 1]);
        sx.lineTo(p[j * 2 + 2], p[j * 2 + 3]);
        sx.stroke();
      }
      // the rounded top of the arm catches the light; the suckers run down its inner side
      sx.strokeStyle = g(highlight);
      px.fillStyle = "#fff";
      for (let j = 0; j < N - 1; j++) {
        const wd = armWidth(j / N);
        const ox = LIGHT[0] * wd * 0.2,
          oy = LIGHT[1] * wd * 0.2;
        sx.lineWidth = wd * 0.38;
        sx.beginPath();
        sx.moveTo(p[j * 2] + ox, p[j * 2 + 1] + oy);
        sx.lineTo(p[j * 2 + 2] + ox, p[j * 2 + 3] + oy);
        sx.stroke();
        if (j >= 2 && j % 2 === 0 && j < N - 3) {
          const dx = p[j * 2 + 2] - p[j * 2],
            dy = p[j * 2 + 3] - p[j * 2 + 1];
          const l = Math.hypot(dx, dy) || 1;
          // the inner side: the side the arm curls toward, or toward the body's axis
          const ex = p[j * 2 + 4] - p[j * 2 + 2],
            ey = p[j * 2 + 5] - p[j * 2 + 3];
          const side = dx * ey - dy * ex >= 0 ? 1 : -1;
          px.beginPath();
          px.arc(
            p[j * 2] + (-dy / l) * side * wd * 0.32,
            p[j * 2 + 1] + (dx / l) * side * wd * 0.32,
            wd * 0.11, // small, so the thicker arms carry no bright spots
            0,
            7,
          );
          px.fill();
        }
      }
    }

    // a filled outline with a soft light falling from LIGHT, centred on (cx, cy)
    function shadedPath(pts, cx, cy, r, hi, lo) {
      const gr = sx.createRadialGradient(
        cx + LIGHT[0] * r * 0.35,
        cy + LIGHT[1] * r * 0.35,
        0,
        cx,
        cy,
        r * 1.05,
      );
      gr.addColorStop(0, g(hi));
      gr.addColorStop(0.5, g(hi * 0.82));
      gr.addColorStop(1, g(lo));
      sx.fillStyle = gr;
      sx.beginPath();
      sx.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) sx.lineTo(pts[i], pts[i + 1]);
      sx.closePath();
      sx.fill();
    }

    // the mantle's half width along its length, s from the neck (0) to the tip (1): widest a
    // third of the way, tapering to a rounded point (render() eases it in from the neck)
    const mantleW = (s) => (s < 0.3 ? 1 : (1 - ((s - 0.3) / 0.7) ** 2.2) ** 0.62);
    // chromatophore patches on the mantle and head, in body coordinates (s along, l across,
    // radius in mantle widths), each darkening and fading on its own slow beat
    const PATCHES = Array.from({ length: 11 }, (_, k) => [
      0.12 + ((k * 0.37) % 0.8),
      (((k * 0.61) % 1) - 0.5) * 1.3,
      0.18 + ((k * 0.29) % 0.16),
      0.15 + ((k * 0.43) % 0.2),
      k * 1.9,
    ]);
    // pale papillae, fixed to the skin
    const PAPILLAE = [
      [0.3, -0.42, 2.6],
      [0.48, 0.3, 2.4],
      [0.66, -0.12, 2.2],
      [0.18, 0.18, 2],
      [0.8, 0.22, 1.8],
    ];

    let eyes = [];
    const KH = 10, // samples along the head
      KM = 24, // ...and the mantle
      NB = KH + KM + 1;
    const axis = new Float32Array(NB * 5); // the body's bent axis, crown to tip (see render())
    const mant = new Float32Array(NB * 4); // the body's outline, one side then the other
    const mantPath = () => {
      const p = new Path2D();
      p.moveTo(mant[0], mant[1]);
      for (let k = 2; k < mant.length; k += 2) p.lineTo(mant[k], mant[k + 1]);
      p.closePath();
      return p;
    };
    function render(t = now) {
      sx.clearRect(0, 0, W, H);
      px.clearRect(0, 0, W, H);

      // the web: a thin, sagging skin between neighbouring arms, out to a fifth of their length
      // or more as they open, scalloped between them
      const wk = Math.max(3, Math.round(N * (0.2 + 0.1 * clamp(pose.spread, 0, 1))));
      sx.fillStyle = g(0.62, 0.95);
      for (let i = 0; i < 7; i++) {
        const a = ARMS[i].p,
          b = ARMS[i + 1].p;
        sx.beginPath();
        sx.moveTo(a[0], a[1]);
        for (let j = 1; j <= wk; j++) sx.lineTo(a[j * 2], a[j * 2 + 1]);
        const mx = (a[wk * 2] + b[wk * 2]) / 2,
          my = (a[wk * 2 + 1] + b[wk * 2 + 1]) / 2;
        const cx = mx + (a[0] - mx) * 0.45,
          cy = my + (a[1] - my) * 0.45;
        sx.quadraticCurveTo(cx, cy, b[wk * 2], b[wk * 2 + 1]);
        for (let j = wk - 1; j >= 0; j--) sx.lineTo(b[j * 2], b[j * 2 + 1]);
        sx.fill();
      }

      armK = 0.82;
      for (const a of ARMS) if (a.far) drawArm(a, 0.46, 0.62);
      armK = 1;

      for (const a of ARMS) if (!a.far) drawArm(a, 0.6, 0.8);

      // The head and mantle are one soft silhouette over the arms' roots, laid along a bent
      // axis: from the arm crown the head (counter-turned into a turn, broadest at the eyes)
      // narrows a little to the neck, then the mantle swells into a sac that leans into the turn,
      // bends further toward its tip and sags a little when the animal hangs relaxed. The sac
      // lengthens and narrows as it squeezes out a jet and swells again as it refills.
      const sq = pose.squeeze;
      const ht = O.th - ARCH_HEAD * O.arch,
        [, , hn0, hn1] = frame0(ht);
      const HL = ML * 0.42 * (1 - 0.06 * sq),
        Hw = MW * 0.33;
      const Lm = ML * 1.1 * (1 + 0.08 * sq),
        Wm = MW * 0.41 * (1 - 0.2 * sq);
      const lean = O.arch + pose.tilt;
      const neckW = Hw * 0.86;
      // the axis, crown to tip: x, y, normal x, normal y, half width
      let hx = O.x,
        hy = O.y,
        mx = O.x,
        my = O.y;
      {
        let ax = O.x,
          ay = O.y;
        for (let k = 0; k <= KH; k++) {
          const v = k / KH; // 0 at the neck, 1 at the crown
          const phi = O.th - ARCH_HEAD * O.arch * v;
          const o = (KH - k) * 5;
          axis[o] = ax;
          axis[o + 1] = ay;
          axis[o + 2] = -Math.sin(phi);
          axis[o + 3] = Math.cos(phi);
          // broadest at the eyes, rounding off over the arm crown
          axis[o + 4] =
            Hw *
            (0.86 + 0.24 * Math.sin(Math.PI * v * 0.95)) *
            (v > 0.7 ? Math.sqrt(1 - 0.6 * ((v - 0.7) / 0.3) ** 2) : 1);
          if (k === Math.round(KH * 0.45)) {
            hx = ax;
            hy = ay;
          }
          ax -= (Math.cos(phi) * HL) / KH;
          ay -= (Math.sin(phi) * HL) / KH;
        }
        ax = O.x;
        ay = O.y;
        for (let k = 1; k <= KM; k++) {
          const s = k / KM;
          const phi = O.th + lean * (0.5 + s);
          const c = Math.cos(phi),
            sn = Math.sin(phi);
          ax += (c * Lm) / KM;
          ay += (sn * Lm) / KM;
          // soft, never quite symmetric: a slow ripple runs along the outline
          const w =
            (neckW + (Wm * mantleW(s) - neckW) * ease(Math.min(1, s / 0.3))) *
            (1 + 0.03 * Math.sin(s * 9 + t * 0.8));
          // relaxed, the sac sags toward the sea floor
          const sag = pose.relax * 0.1 * ML * s * s * Math.abs(c);
          const o = (KH + k) * 5;
          axis[o] = ax;
          axis[o + 1] = ay + sag;
          axis[o + 2] = -sn;
          axis[o + 3] = c;
          axis[o + 4] = w;
          if (k === Math.round(KM * 0.42)) {
            mx = ax;
            my = ay + sag;
          }
        }
        for (let k = 0; k < NB; k++) {
          const o = k * 5,
            w = axis[o + 4];
          mant[k * 2] = axis[o] + axis[o + 2] * w;
          mant[k * 2 + 1] = axis[o + 1] + axis[o + 3] * w;
          mant[(2 * NB - 1 - k) * 2] = axis[o] - axis[o + 2] * w;
          mant[(2 * NB - 1 - k) * 2 + 1] = axis[o + 1] - axis[o + 3] * w;
        }
      }
      const mt = O.th + lean;
      const m0 = Math.cos(mt),
        m1 = Math.sin(mt);
      shadedPath(mant, mx, my, (Lm + HL) * 0.62, 1, 0.38);

      // the head is rounded too, its own soft light
      {
        const gr = sx.createRadialGradient(
          hx + LIGHT[0] * Hw * 0.4,
          hy + LIGHT[1] * Hw * 0.4,
          0,
          hx,
          hy,
          Hw * 1.3,
        );
        gr.addColorStop(0, g(0.95, 0.5));
        gr.addColorStop(1, g(0.95, 0));
        sx.save();
        sx.clip(mantPath());
        sx.fillStyle = gr;
        sx.fillRect(hx - Hw * 2, hy - Hw * 2, Hw * 4, Hw * 4);
        sx.restore();
      }
      // a faint crease at the neck, where the mantle opening runs round
      {
        const gr = sx.createLinearGradient(
          O.x - m0 * 0.14 * ML,
          O.y - m1 * 0.14 * ML,
          O.x + m0 * 0.14 * ML,
          O.y + m1 * 0.14 * ML,
        );
        gr.addColorStop(0, g(0.35, 0));
        gr.addColorStop(0.5, g(0.35, 0.3));
        gr.addColorStop(1, g(0.35, 0));
        sx.save();
        sx.clip(mantPath());
        sx.fillStyle = gr;
        sx.fillRect(O.x - ML, O.y - ML, ML * 2, ML * 2);
        sx.restore();
      }
      const hw = Hw;
      // in body coordinates: s along the mantle, l across it in half widths
      const onMantle = (s, l) => [
        O.x + m0 * (s * Lm - 0.04 * ML) - m1 * l * Wm,
        O.y + m1 * (s * Lm - 0.04 * ML) + m0 * l * Wm,
      ];
      // a few soft folds across it where it joins the head
      sx.strokeStyle = g(0.5, 0.3);
      sx.lineWidth = 1.2 * S;
      for (const s of [0.08, 0.15]) {
        const w = mantleW(s) * 0.8;
        const [x0, y0] = onMantle(s, -w),
          [x1, y1] = onMantle(s, w),
          [xc, yc] = onMantle(s + 0.05, 0);
        sx.beginPath();
        sx.moveTo(x0, y0);
        sx.quadraticCurveTo(xc, yc, x1, y1);
        sx.stroke();
      }
      // mottling: darker patches that slowly come and go
      for (const [s, l, r, d, ph] of PATCHES) {
        const k = 0.5 + 0.5 * Math.sin(t * 0.23 + ph);
        if (k < 0.15) continue;
        const [x, y] = onMantle(s, l * mantleW(s));
        const R = r * Wm;
        const gr = sx.createRadialGradient(x, y, 0, x, y, R);
        gr.addColorStop(0, g(0.3, d * k));
        gr.addColorStop(1, g(0.3, 0));
        sx.fillStyle = gr;
        sx.beginPath();
        sx.arc(x, y, R, 0, 7);
        sx.fill();
      }
      px.fillStyle = "#fff";
      for (const [s, l, r] of PAPILLAE) {
        const [x, y] = onMantle(s, l * mantleW(s));
        px.beginPath();
        px.arc(x, y, r * 0.6 * S, 0, 7);
        px.fill();
      }

      // the eyes: low bumps on the sides of the head, skin-coloured, each with a small dark
      // pupil, a slit held level whichever way the body points. As we look down on the animal
      // the eyes sit on its flanks: the one on the side it rolls toward (its heading and the
      // bend of a turn) shows a little, the other hardly at all.
      const roll = clamp(0.55 * Math.cos(ht) + 0.6 * Math.tanh((3 * O.arch) / ARCH), -1, 1);
      eyes = [];
      for (const side of [-1, 1]) {
        const vis = clamp(0.12 + 0.6 * side * roll, 0, 0.72);
        if (vis < 0.05) continue;
        const ex = hx + hn0 * side * hw * 0.97,
          ey = hy + hn1 * side * hw * 0.97;
        sx.fillStyle = g(0.78, 0.5 + 0.5 * vis);
        sx.beginPath();
        sx.ellipse(ex, ey, ML * 0.11, MW * 0.08 * (0.6 + 0.4 * vis), ht, 0, 7);
        sx.fill();
        // the pupil, a short level dash
        sx.strokeStyle = g(0.32, 0.8 * vis);
        sx.lineWidth = Math.max(1, ML * 0.035);
        sx.lineCap = "round";
        sx.beginPath();
        sx.moveTo(ex - ML * 0.055 * vis, ey);
        sx.lineTo(ex + ML * 0.055 * vis, ey);
        sx.stroke();
        if (vis > 0.3) eyes.push([ex, ey]);
      }

      // only the cells around the animal are sampled
      let x0 = Infinity,
        y0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity;
      const grow = (x, y, r) => {
        x0 = Math.min(x0, x - r);
        y0 = Math.min(y0, y - r);
        x1 = Math.max(x1, x + r);
        y1 = Math.max(y1, y + r);
      };
      grow(O.x, O.y, ML * 0.8);
      for (let k = 0; k < mant.length; k += 2) grow(mant[k], mant[k + 1], 4);
      for (const a of ARMS) for (let j = 0; j < a.p.length; j += 2) grow(a.p[j], a.p[j + 1], 12);
      return {
        mx,
        my,
        c0: Math.max(0, Math.floor(x0 / CELL)),
        r0: Math.max(0, Math.floor(y0 / CELL)),
        c1: Math.min(cols - 1, Math.ceil(x1 / CELL)),
        r1: Math.min(rows - 1, Math.ceil(y1 / CELL)),
      };
    }

    const CHARS = [".", ":", "+", "x", "%", "8"];
    const RAMP = " .:-=+*#%@";

    // --- the luminous style: the characters are the image ------------------------------------
    // Brightness picks the glyph from a ramp and its colour and opacity, the arms drift toward
    // the palette's tint, the edges break up into specks, a few bright cells are lit (a square
    // behind a dark glyph), and a soft bloom of the whole lot is laid back over it.
    const RAMPS = { jelly: " '.:ot%SX8#@", classic: " .:-=+*#%@", binary: " .:01" };
    // a stable hash of a cell and a seed, in [0, 1)
    const hash = (c, r, s) => {
      let h = Math.imul(c, 374761393) + Math.imul(r, 668265263) + Math.imul(s, 1274126177);
      h = Math.imul(h ^ (h >>> 13), 1103515245);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    const glowA = document.createElement("canvas"),
      glowB = document.createElement("canvas");
    const ga = glowA.getContext("2d"),
      gb = glowB.getContext("2d");
    let frameNo = 0;

    // a faint grid on the cell boundaries, only in the water around the octopus (it is part of
    // the animal's look, not the page's), fading out from its body
    function drawGrid() {
      const R = 300 * S;
      const c0 = Math.max(1, Math.floor((O.x - R) / CELL)),
        c1 = Math.min(cols - 1, Math.ceil((O.x + R) / CELL)),
        r0 = Math.max(1, Math.floor((O.y - R) / CELL)),
        r1 = Math.min(rows - 1, Math.ceil((O.y + R) / CELL));
      ctx.beginPath();
      for (let c = c0; c <= c1; c++) {
        ctx.moveTo(c * CELL, r0 * CELL);
        ctx.lineTo(c * CELL, r1 * CELL);
      }
      for (let r = r0; r <= r1; r++) {
        ctx.moveTo(c0 * CELL, r * CELL);
        ctx.lineTo(c1 * CELL, r * CELL);
      }
      const fade = ctx.createRadialGradient(O.x, O.y, 0, O.x, O.y, R);
      fade.addColorStop(0, GRIDC);
      fade.addColorStop(0.45, GRIDC);
      fade.addColorStop(1, "rgba(0,0,0,0)");
      ctx.strokeStyle = fade;
      ctx.lineWidth = 1 / dpr;
      ctx.globalAlpha = tune.grid * (dark ? 0.2 : 0.22);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    function luminous(box, bw, bh, sd, pd, eyeCells) {
      const n = bw * bh,
        Lm = new Float32Array(n),
        Am = new Float32Array(n),
        Pm = new Float32Array(n);
      const rowW = bw * SS * 4,
        k = SS * SS * 255;
      for (let r = 0; r < bh; r++)
        for (let c = 0; c < bw; c++) {
          let L = 0,
            A = 0,
            P = 0;
          for (let yy = 0; yy < SS; yy++)
            for (let xx = 0; xx < SS; xx++) {
              const o = (r * SS + yy) * rowW + (c * SS + xx) * 4;
              L += sd[o] * sd[o + 3];
              A += sd[o + 3];
              P += pd[o + 3];
            }
          Lm[r * bw + c] = L / k / 255;
          Am[r * bw + c] = A / k;
          Pm[r * bw + c] = P / k;
        }

      const ramp = RAMPS[tune.ramp] || RAMPS.jelly,
        top = ramp.length - 1;
      const seed = frameNo >> 4; // the lit cells twinkle a few times a second
      const reach = ML * 2.4;
      const al = tune.alpha,
        lit = tune.lit * 0.3,
        dith = tune.dither;
      const AQ = 6; // opacity steps
      const buckets = new Map(); // colour|opacity step -> x, y, char, ...
      const put = (col, aq, x, y, ch) => {
        const key = col + "|" + aq;
        let b = buckets.get(key);
        if (!b) buckets.set(key, (b = []));
        b.push(x, y, ch);
      };
      const tiles = []; // lit squares: x, y, opacity
      const under = []; // the faint cell behind each covered glyph: x, y
      const flat = !!C.flat;
      // lit cells stay off the outline (a pair of them there reads as eyes)
      const inside = (c, r) =>
        c > 0 &&
        r > 0 &&
        c < bw - 1 &&
        r < bh - 1 &&
        Am[r * bw + c - 1] > 0.6 &&
        Am[r * bw + c + 1] > 0.6 &&
        Am[(r - 1) * bw + c] > 0.6 &&
        Am[(r + 1) * bw + c] > 0.6;
      // no lit cells round the eyes: they would read as a gaze
      const nearEye = (x, y) =>
        eyes.some(
          ([ex, ey]) =>
            Math.abs(ex - x - CELL / 2) < CELL * 3.5 && Math.abs(ey - y - CELL / 2) < CELL * 3.5,
        );

      for (let r = 0; r < bh; r++)
        for (let c = 0; c < bw; c++) {
          const i = r * bw + c,
            gc = box.c0 + c,
            gr = box.r0 + r;
          const gx = gc * CELL,
            gy = gr * CELL;
          const lum = Lm[i],
            A = Am[i],
            P = Pm[i];
          const h0 = hash(gc, gr, 0);
          // hue: toward the tint with distance from the mantle, a little noise across it
          const d = Math.hypot(gx + CELL / 2 - box.mx, gy + CELL / 2 - box.my) / reach;
          const hq = Math.round(clamp(tune.hue * (d * 1.7 - 0.1 + (h0 - 0.5) * 0.5), 0, 1) * 3);
          if (A < 0.12) {
            // specks just off the body, thinning out over two cells
            if (!dith || flat || h0 > dith * 0.55) continue;
            let near = 0;
            for (let dy = -2; dy <= 2; dy++)
              for (let dx = -2; dx <= 2; dx++) {
                const cc = c + dx,
                  rr = r + dy;
                if (cc >= 0 && rr >= 0 && cc < bw && rr < bh)
                  near = Math.max(near, Am[rr * bw + cc] * (1 - Math.hypot(dx, dy) / 3.2));
              }
            if (h0 < dith * 0.55 * near)
              put(
                LUT[hq][3],
                Math.max(1, Math.round(AQ * al * 0.5)),
                gx,
                gy,
                h0 < dith * 0.1 ? ":" : h0 < dith * 0.3 ? "." : "'",
              );
            continue;
          }
          // the edges thin out: the less of the cell is covered, the likelier it is dropped
          if (A < 0.5 && hash(gc, gr, 7) < dith * (0.5 - A) * 1.6) continue;
          // the shade picks the glyph, thinned where the cell is only partly covered
          const shade = lum / A;
          let v = flat
            ? 0.4 + 0.6 * A
            : clamp(((shade - 0.25) / 0.72) * (0.35 + 0.65 * Math.sqrt(A)), 0, 1) ** 0.8;
          // the arms fade toward their tips
          if (d > 0.55) v *= 1 - 0.25 * clamp((d - 0.55) / 0.6, 0, 1);
          // the eyes are only a little darker than the skin round them, never lit
          const eye = eyeCells.has(gc + "," + gr);
          if (eye) v *= 0.8;
          else if (P > 0.45) v = Math.min(1, v + 0.15);
          const lv = Math.round(v * (LV - 1));
          const col = LUT[hq][lv];
          if (tune.grid) under.push(gx, gy);
          const aq = Math.max(1, Math.round(AQ * al * (0.7 + 0.3 * v) * (0.8 + 0.2 * A)));
          let ch;
          if (tune.ramp === "binary") ch = v < 0.18 ? "." : v < 0.3 ? ":" : h0 < 0.5 ? "0" : "1";
          else {
            const j = Math.round(v * top + (h0 - 0.5) * 2.6);
            ch = ramp[j < 1 ? 1 : j > top ? top : j];
          }
          // lit cells: sparse, never side by side, on the mantle and the pale spots, never by
          // the eyes
          if (
            ((v > 0.6 && d < 0.32) || P > 0.45) &&
            (gc + gr) % 2 === 0 &&
            hash(gc, gr, seed) < lit * (v - 0.35) * 1.4 &&
            inside(c, r) &&
            !nearEye(gx, gy)
          ) {
            tiles.push(gx, gy, al * (0.45 + 0.5 * v));
            put(BG, AQ, gx, gy, ch);
          } else put(col, aq, gx, gy, ch);
        }

      // the faint cells behind the glyphs, then the lit squares, then the glyphs
      const inset = CELL * 0.06,
        sz = CELL - inset * 2;
      if (under.length) {
        ctx.globalAlpha = tune.grid * (dark ? 0.34 : 0.16);
        ctx.fillStyle = GRIDC;
        ctx.beginPath();
        for (let i = 0; i < under.length; i += 2)
          ctx.rect(under[i] + inset, under[i + 1] + inset, sz, sz);
        ctx.fill();
      }
      ctx.fillStyle = LIT;
      for (let i = 0; i < tiles.length; i += 3) {
        ctx.globalAlpha = tiles[i + 2];
        ctx.fillRect(tiles[i] + inset, tiles[i + 1] + inset, sz, sz);
      }
      ctx.font = `500 ${Math.round(CELL * 0.92)}px "Geist Mono", monospace`;
      for (const [key, b] of buckets) {
        const bar = key.lastIndexOf("|");
        ctx.fillStyle = key.slice(0, bar);
        ctx.globalAlpha = +key.slice(bar + 1) / AQ;
        for (let i = 0; i < b.length; i += 3)
          ctx.fillText(b[i + 2], b[i] + CELL / 2, b[i + 1] + CELL / 2 + 0.5);
      }
      ctx.globalAlpha = 1;

      // bloom: the body's region shrunk twice (which blurs it) and laid back over, added on a
      // dark page, multiplied on a light one
      if (tune.glow > 0) {
        const x = box.c0 * CELL,
          y = box.r0 * CELL,
          w = bw * CELL,
          h = bh * CELL;
        const aw = Math.max(1, Math.ceil(w / 4)),
          ah = Math.max(1, Math.ceil(h / 4)),
          bw2 = Math.max(1, Math.ceil(w / 10)),
          bh2 = Math.max(1, Math.ceil(h / 10));
        if (glowA.width < aw || glowA.height < ah) {
          glowA.width = Math.max(glowA.width, aw);
          glowA.height = Math.max(glowA.height, ah);
        }
        if (glowB.width < bw2 || glowB.height < bh2) {
          glowB.width = Math.max(glowB.width, bw2);
          glowB.height = Math.max(glowB.height, bh2);
        }
        ga.clearRect(0, 0, aw, ah);
        ga.drawImage(cv, x * dpr, y * dpr, w * dpr, h * dpr, 0, 0, aw, ah);
        gb.clearRect(0, 0, bw2, bh2);
        gb.drawImage(glowA, 0, 0, aw, ah, 0, 0, bw2, bh2);
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.globalCompositeOperation = dark ? "lighter" : "multiply";
        ctx.globalAlpha = Math.min(1, tune.glow * (dark ? 1.1 : 0.5));
        ctx.drawImage(glowB, 0, 0, bw2, bh2, x, y, w, h);
        ctx.globalAlpha = Math.min(1, tune.glow * (dark ? 0.6 : 0.3));
        ctx.drawImage(glowA, 0, 0, aw, ah, x, y, w, h);
        ctx.restore();
      }
      // the grid goes in last, behind everything (so the bloom never picks its lines up)
      if (tune.grid > 0) {
        ctx.globalCompositeOperation = "destination-over";
        drawGrid();
        ctx.globalCompositeOperation = "source-over";
      }
    }

    function draw() {
      const box = render();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const lumi = tune.glyphs === "luminous";
      frameNo++;

      // marine snow
      ctx.font = `${Math.round(Math.max(8, CELL))}px "Geist Mono", monospace`;
      ctx.fillStyle = C.snow + "0.16)";
      for (const s of snow) {
        const cx = Math.floor(s.x / CELL),
          cy = Math.floor(s.y / CELL);
        ctx.fillText(s.ch, cx * CELL + CELL / 2, cy * CELL + CELL / 2);
      }
      for (const b of wake) {
        ctx.fillStyle = C.snow + (0.4 * Math.min(1, b.life * 2)).toFixed(2) + ")";
        ctx.fillText(
          "·",
          Math.floor(b.x / CELL) * CELL + CELL / 2,
          Math.floor(b.y / CELL) * CELL + CELL / 2,
        );
      }

      const bw = box.c1 - box.c0 + 1,
        bh = box.r1 - box.r0 + 1;
      if (bw <= 0 || bh <= 0) {
        if (lumi && tune.grid > 0) drawGrid();
        return;
      }
      const sd = sx.getImageData(box.c0 * SS, box.r0 * SS, bw * SS, bh * SS).data;
      const pd = px.getImageData(box.c0 * SS, box.r0 * SS, bw * SS, bh * SS).data;
      const rowW = bw * SS * 4;
      const buckets = {};
      const glyphs = [];
      const add = (col, x, y, a) => (buckets[col + "|" + a] ||= []).push(x, y);
      const eyeCells = new Set(
        eyes.map(([x, y]) => Math.floor(x / CELL) + "," + Math.floor(y / CELL)),
      );
      const k = SS * SS * 255;
      const ascii = tune.glyphs === "ascii" && CELL >= 5;
      if (lumi) return luminous(box, bw, bh, sd, pd, eyeCells);

      for (let r = 0; r < bh; r++) {
        for (let c = 0; c < bw; c++) {
          let L = 0,
            A = 0,
            P = 0;
          for (let yy = 0; yy < SS; yy++)
            for (let xx = 0; xx < SS; xx++) {
              const o = (r * SS + yy) * rowW + (c * SS + xx) * 4;
              L += sd[o] * sd[o + 3];
              A += sd[o + 3];
              P += pd[o + 3];
            }
          const lum = L / k / 255; // shade × coverage
          A /= k;
          P /= k;
          const gx = (box.c0 + c) * CELL,
            gy = (box.r0 + r) * CELL;
          if (eyeCells.has(box.c0 + c + "," + (box.r0 + r))) {
            // a low-contrast bump in the skin's own tones, not a dark hole with a bright pupil
            add(C.flat ? C.on : C.deep, gx, gy, C.flat ? 0.55 : 1);
            if (!C.flat) glyphs.push(gx, gy, "o", C.grey);
            continue;
          }
          if (lum < 0.08) continue;
          let col;
          if (C.flat) col = A > 0.4 ? C.on : null;
          else if (A < 0.35 || lum < 0.2) col = C.fringe;
          else if (P > 0.45) col = lum > 0.62 ? C.hi : C.pale;
          else if (lum > 0.8) col = C.lt;
          else if (lum > 0.52) col = C.mid;
          else if (lum > 0.3) col = C.deep;
          else col = C.grey;
          if (!col) continue;
          if (ascii) {
            // tiles + ascii: a quiet tile carrying a character from the ramp in its colour
            add(col, gx, gy, 0.3);
            const v = C.flat ? 0.4 + 0.6 * A : lum * (0.4 + 0.6 * A);
            glyphs.push(gx, gy, RAMP[Math.max(2, Math.min(9, Math.round(v * 9)))], col);
            continue;
          }
          add(col, gx, gy, 1);
          if (tune.glyphs === "subtle" && !C.flat && col !== C.fringe)
            glyphs.push(gx, gy, CHARS[Math.min(5, Math.floor(lum * 6))], C.glyph);
        }
      }

      // tile, gap and corner scale with the cell, as at v5's 10px: 8.5px tiles, 1.6px corners
      const sz = CELL * 0.85,
        inset = CELL * 0.075;
      for (const key in buckets) {
        const [col, a] = key.split("|");
        ctx.globalAlpha = +a;
        ctx.fillStyle = col;
        ctx.beginPath();
        const b = buckets[key];
        for (let i = 0; i < b.length; i += 2)
          ctx.roundRect(b[i] + inset, b[i + 1] + inset, sz, sz, CELL * 0.16);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.font = ascii
        ? `600 ${CELL * 0.92}px "Geist Mono", monospace`
        : `500 ${CELL * 0.75}px "Geist Mono", monospace`;
      for (let i = 0; i < glyphs.length; i += 4) {
        ctx.fillStyle = glyphs[i + 3];
        ctx.fillText(glyphs[i + 2], glyphs[i] + CELL / 2, glyphs[i + 1] + CELL / 2 + 0.5);
      }
    }

    let prev = 0,
      now = 0,
      paused = false;
    function frame(ms) {
      const dt = Math.min(0.05, (ms - prev) / 1000 || 0.016);
      prev = ms;
      if (!paused) {
        now += dt;
        update(dt, now);
        draw();
      }
      requestAnimationFrame(frame);
    }

    // scrolled() turns the page's scrolling into a turn
    let lastScroll = scrollY;
    addEventListener(
      "scroll",
      () => {
        scrollAcc += scrollY - lastScroll;
        lastScroll = scrollY;
      },
      { passive: true },
    );

    addEventListener("pointermove", (e) => (ptr = { x: e.clientX, y: e.clientY }));
    addEventListener("pointerdown", (e) => {
      if (e.target.closest("a,button,input,label,.card,.tune")) return;
      fright(e.clientX, e.clientY);
    });
    // a click nearby is a fright on its own
    function fright(x, y) {
      ptr = { x, y };
      if (Math.hypot(x - O.x, y - O.y) < 260 * S * tune.react) {
        O.fear = Math.min(1, O.fear + 0.15);
        startFlee(2.5);
      }
    }
    const gone = () => ((ptr = null), (lastD = Infinity));
    addEventListener("pointerout", (e) => !e.relatedTarget && gone());
    addEventListener("pointerup", (e) => e.pointerType !== "mouse" && gone());
    addEventListener("pointercancel", gone);

    // Lay the arms on their pose and let them hang in still water for a moment.
    function settle(t0, secs) {
      for (const a of ARMS) {
        armTarget(a, t0);
        a.p.set(a.t);
        a.q.set(a.t);
      }
      for (let i = 0, n = Math.round(secs * 100); i < n; i++) stepArms(0.01, t0 + i * 0.01);
    }

    function start() {
      resize();
      recolor();
      O.x = band ? colR + (W - colR) * 0.5 : W * 0.62;
      O.y = H * (W < 700 ? 0.8 : 0.42);
      O.th = -2.2;
      pickWaypoint();
      settle(0, 2);
      fit();
      addEventListener("resize", () => {
        resize();
        fit();
        if (reduced) draw();
      });
      draw();
      if (!reduced) {
        running = true;
        requestAnimationFrame((ms) => {
          prev = ms;
          now = ms / 1000;
          settle(now - 2, 2);
          requestAnimationFrame(frame);
        });
      }
    }
    // Change any of DEFAULTS' knobs; applies at once. Returns the current settings.
    function set(opts = {}) {
      for (const key in DEFAULTS)
        if (key in opts) {
          const v = opts[key];
          if (typeof DEFAULTS[key] === "number") {
            if (Number.isFinite(+v)) tune[key] = +v;
          } else if (CHOICES[key].includes(v)) tune[key] = v;
        }
      if (W && ("density" in opts || "size" in opts)) {
        resize();
        fit();
      }
      if (W && (reduced || !running)) draw();
      return { ...tune };
    }

    // A handle for a test bench: pause the clock, step it by hand, drive the pointer and the
    // scroll, and read the state as plain data. Nothing here runs unless it is called.
    const lab = {
      pause: () => void (paused = true),
      resume: () => void (paused = false),
      // a seeded random (mulberry32), so stepped runs repeat exactly; seed(null) undoes it
      seed(n) {
        let a = n >>> 0;
        random =
          n == null
            ? Math.random
            : () => {
                a = (a + 0x6d2b79f5) >>> 0;
                let t = Math.imul(a ^ (a >>> 15), 1 | a);
                t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
                return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
              };
      },
      step(dt = 1 / 60, n = 1) {
        for (let i = 0; i < n; i++) {
          now += dt;
          update(dt, now);
        }
        draw();
      },
      // the shading field and pale pattern the painters sample (supersampled cells), to judge
      // the anatomy apart from the painting
      layers: () => ({ shade, pat, scale: SS / CELL }),
      pointer: (x, y) => (x == null ? gone() : (ptr = { x, y })),
      click: (x, y) => fright(x, y),
      // as if the window had just been resized (resize the stage's frame first)
      resize: () => {
        resize();
        fit();
      },
      // as if the page scrolled by dy px since the last frame
      scroll: (dy) => void (scrollAcc += dy),
      // start over: the animal at rest somewhere, facing somewhere, unafraid, its arms settled
      // on their pose, the clock at 0 (with seed() first, a run then repeats exactly)
      place(x, y, th = O.th) {
        Object.assign(O, { x, y, th, vx: 0, vy: 0, w: 0, mode: "drift", phase: 0, period: 1.6 });
        Object.assign(O, { strokes: 0, thrust: 1, hurry: false, fear: 0, fleeMin: 0, grip: 0 });
        Object.assign(O, { rest: 3, wander: 0, wpAge: 0, fleeA: th, pc: 0.28, shut: 0, loose: 0 });
        Object.assign(O, { sv: 0, sk: 0, ws: 0, arch: 0, burst: 3, gather: 0, settle: false });
        Object.assign(pose, { spread: 0.6, curl: 1, relax: 1, wave: 0.6, squeeze: 0, tilt: 0 });
        for (const a of ARMS) Object.assign(a, { sp: 0.6, ex: 0, exT: -1 });
        Object.assign(O, { weave: 0, style: "jet", reach: REACH + 4, edgeSide: 0, edgeK: 0 });
        visits.fill(0);
        avoidAge = 1;
        exploreIn = 1;
        ptr = null;
        lastD = Infinity;
        closing = 0;
        scrollAcc = 0;
        wake.length = 0;
        now = 0;
        walled = 0;
        pickWaypoint();
        settle(-2, 2);
        fit();
      },
      snapshot: () => ({
        t: now,
        x: O.x,
        y: O.y,
        vx: O.vx,
        vy: O.vy,
        th: O.th,
        w: O.w + O.ws,
        arch: O.arch,
        rest: O.rest,
        mode: O.mode,
        phase: O.phase,
        period: O.period,
        pc: O.pc,
        shut: O.shut,
        hurry: O.hurry,
        fear: O.fear,
        grip: O.grip,
        scroll: O.sv,
        ML,
        MW,
        AL,
        REACH,
        cell: CELL,
        W,
        H,
        arms: ARMS.map((a) => Array.from(a.p)),
        walled,
        behind: behind(O.x, O.y) > 0,
      }),
    };

    return { start, recolor, set, defaults: { ...DEFAULTS }, lab };
  })();
}
