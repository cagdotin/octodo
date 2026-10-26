// The octopus lab's engine: deterministic scenarios driven through `sea.lab` (see octopus.js),
// per-frame measurements, pass/fail checks and filmstrips. Shared by ../lab.html (for people)
// and run.cjs (headless, in Electron). Plain browser JS, no build; exposes `window.LAB`.
//
// Everything is measured in the body's own frame: `along` the mantle axis (forward positive)
// and `lat`eral across it (toward octopus.js's +n side), and normalised by the mantle length ML.
// Arms 0-3 hang off the -n side, arms 4-7 off the +n side; node 0 is the root, 16 the tip.
{
  const DT = 1 / 120; // fixed step, s
  const SERIES_EVERY = 4; // keep every 4th frame for the charts (30 Hz)
  const JH = 4; // jerk is measured over steps this far apart (1/30 s)

  // ---------------------------------------------------------------------------------------
  // THRESHOLDS: every pass/fail limit in one place. Lengths are in mantle lengths (ML), speeds
  // in ML/s, times in s. Where a value comes from octopus.js or from the user's feedback, the
  // comment says so; the rest are judgement calls, chosen before looking at v6's numbers.
  // ---------------------------------------------------------------------------------------
  const THRESHOLDS = {
    // "strokes after the first two never open wider than the cap": octopus.js's REACH
    // (2.25 ML, read from snapshot().REACH) plus 2% for its soft easing near the limit
    reachTol: 1.02,
    // "late-stroke spread stays within about 15% of strokes 1-2": one-sided, a late stroke may
    // open less but not more than 15% wider than strokes 1-2 did
    lateSpreadBand: 0.15,
    // "a full-fear stroke closes about as fully as cruise": the most-closed moment of a stroke
    // (mean tip distance from the axis) at fear >= fullFear, at most this times cruise's
    fullFear: 0.95,
    fullFearCloseRatio: 1.25,
    // "tips stall during close/glide in less than about 5% of frames": a tip still open (more
    // than stallOpen off the axis) that moves slower than stallSpeed relative to the body
    stallSpeed: 0.3,
    stallOpen: 0.75,
    stallFrac: 0.05,
    // "no mid or 3/4 point crosses the midline during the close; tips cross by less than about
    // 0.35 ML". midCross is a measuring tolerance, not an allowance.
    midCross: 0.02,
    tipCross: 0.35,
    // tip speed relative to the body. By octopus.js's own timing the close takes ~0.29 s (flee)
    // to 0.45 s (cruise) and brings a tip ~2.3 ML in: about 8 ML/s on average, ~12 ML/s at the
    // peak of a smooth (eased) close. p99 should stay under 10, and no arm point should ever pass
    // 15 ML/s: anything faster is a whip or a flick, not the close. (First set at 6/12 before
    // that arithmetic; revised from octopus.js's timings, not from v6's measurements.)
    tipP99: 10,
    flick: 15,
    // resting. "never upside down at the top or bottom": mantle leading more than 35 degrees
    // below level (octopus.js's own offside() line, sin(th) > 0.574), within edgeZone of the
    // top or bottom edge. upsideGrace: elsewhere, a rest may take this long to right itself
    // before it counts (a warning only).
    upsideSin: 0.574,
    edgeZone: 4,
    upsideGrace: 1.5,
    // "never stuck facing an edge for more than about 1s": within edgeNear of an edge with the
    // mantle pointing at it (cos > facingCos, i.e. within 60 degrees)
    edgeNear: 2.5,
    facingCos: 0.5,
    facingMax: 1.0,
    // "rest durations vary": coefficient of variation over all complete rests in the suite, and
    // no 0.5 s bin holding more than restModeShare of them. A uniform 3-7 s draw gives a CV of
    // about 0.23, which reads as a metronome; 0.3 asks for visibly short and long rests.
    restCV: 0.3,
    restBin: 0.5,
    restModeShare: 0.4,
    restMinN: 6,
    // "we should never have 8s hovers. the hovers are at max 3 seconds... generally I want to
    // have continuous movement without long stops." restMax: the longest rest anywhere (a rest
    // cut short by a fright counts up to the fright). stillSpeed: below this body speed it is
    // standing still; cruise may spend at most stillFrac of its time so, and no scenario may
    // stand still longer than stillMax at a stretch. The rest every run starts with (sea.lab's
    // place() sets a fixed one) and the stillness from t = 0 don't count.
    restMax: 3.0,
    stillSpeed: 0.3,
    stillFrac: 0.15,
    stillMax: 3.0,
    // "turns show some body arch": while turning faster than archTurnW rad/s, a mean bend of at
    // least archMinDeg and a correlation of at least archCorr between bend and turn rate.
    // Only a warning when snapshot() has no bend field and it is estimated from the arms.
    archTurnW: 0.6,
    archMinDeg: 4,
    archCorr: 0.3,
    // an arm crossing itself (non-adjacent segments) in more than this share of frames (warning)
    selfCross: 0.01,

    // --- per-frame anomaly flags (marked on timelines and contact sheets, not pass/fail) ---
    // jerk, the third derivative of position in the screen frame, measured over 1/30 s steps.
    // Arm: octopus.js's close brings a tip ~2.3 ML in ~0.29 s, a peak speed of ~12 ML/s; the
    // flag marks a tip whose velocity swings by twice that within one 1/30 s step
    // (2 x 12 / (1/30)^2 ~ 20000 ML/s^3), an outlier rather than an ordinary close (which runs
    // ~7000-17000 at p99 in v6). Body: the jet (up to ~19 ML/s^2 reached in ~0.15 s) gives the
    // body ~200 ML/s^3; flag ~3x that.
    jerkArm: 20000,
    jerkBody: 600,
    // a change of turn rate faster than this (rad/s^2): octopus.js eases its turn at 2.6/s
    // toward at most ~1.3 rad/s, plus scrolling's 0.7 rad/s at 4/s, so ~7 rad/s^2 at most
    headingSnap: 15,
    // turning faster than archTurnW with less bend than this, for longer than noArchFor
    noArchDeg: 1,
    noArchFor: 0.25,
  };
  const T = THRESHOLDS;
  // flag kinds: bit, short code for contact sheets, colour, what it means
  const FLAGS = {
    flick: [1, "FLK", "an arm point moves faster than `flick` vs the body"],
    jerkArm: [2, "JRK", "an arm's mid, 3/4 point or tip jerks harder than `jerkArm`"],
    jerkBody: [4, "JRB", "the mantle top or head jerks harder than `jerkBody`"],
    midline: [8, "MID", "a mid/3-4 point or a tip past the midline while closing"],
    tangle: [
      16,
      "TNG",
      "an arm crosses itself, or two arms of one side and layer cross while closing",
    ],
    stall: [32, "STL", "an open tip stalls during the close/glide"],
    cap: [64, "CAP", "a point past REACH while the reach is held (grip ~1)"],
    snap: [128, "SNP", "the turn rate changes faster than `headingSnap`"],
    noArch: [256, "ARC", "turning with no body arch for a while"],
    upside: [512, "UPS", "resting mantle-down near the top or bottom"],
  };
  const flagCodes = (bits) =>
    Object.values(FLAGS)
      .filter(([b]) => bits & b)
      .map(([, c]) => c);
  // flags about the arms' or body's motion in that very frame get a red border; the slower
  // pose ones (no arch, upside down) only an amber label
  const MOTION = 1 | 2 | 4 | 8 | 16 | 32 | 64 | 128;
  const RING = 1 | 8 | 64; // marked on the tip traces: flick, midline, cap

  // The animal's settings for every run: the user's tuning (sea.set knobs) and palette, set
  // explicitly so that older copies of octopus.js with other defaults run the same way. The lab
  // page (?tune=, ?palette=) and run.cjs (--tune, --palette) override them.
  const TUNE = { density: 1.8, glyphs: "ascii", size: 1.1, speed: 1.9, react: 0.35, scroll: 1.4 };
  const PALETTE = "ink";

  // --- small helpers -----------------------------------------------------------------------
  const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
  const easeOut = (u) => 1 - (1 - Math.min(1, Math.max(0, u))) ** 3;
  const quant = (arr, q) => {
    if (!arr.length) return NaN;
    const s = Float64Array.from(arr).sort();
    return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))];
  };
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  const sd = (a) => {
    const m = mean(a);
    return Math.sqrt(mean(a.map((x) => (x - m) ** 2)));
  };
  const corr = (a, b) => {
    const ma = mean(a),
      mb = mean(b);
    let num = 0,
      da = 0,
      db = 0;
    for (let i = 0; i < a.length; i++) {
      num += (a[i] - ma) * (b[i] - mb);
      da += (a[i] - ma) ** 2;
      db += (b[i] - mb) ** 2;
    }
    return da && db ? num / Math.sqrt(da * db) : NaN;
  };
  // a text sparkline: n columns, each the mean of its slice, scaled 0..max
  const spark = (xs, n = 60) => {
    if (!xs.length) return "";
    const max = Math.max(...xs) || 1,
      bars = " ▁▂▃▄▅▆▇█";
    let out = "";
    for (let c = 0; c < n; c++) {
      const a = Math.floor((c * xs.length) / n),
        b = Math.max(a + 1, Math.floor(((c + 1) * xs.length) / n));
      const m = mean(xs.slice(a, b));
      out += bars[Math.round((m / max) * 8)];
    }
    return out;
  };
  const r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : v);
  const segX = (ax, ay, bx, by, cx, cy, dx, dy) => {
    const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax),
      d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
    if (d1 * d2 >= 0) return false;
    const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx),
      d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
    return d3 * d4 < 0;
  };

  // --- driving the animal ----------------------------------------------------------------------
  // A driver is called before every step with c = { t, i, s (latest snapshot), L (sea.lab),
  // st (its own scratch state), W, H, near, click }. It may move the pointer, click or scroll.
  // near and click are octopus.js's own radii in px at the current size and `react`: a pointer
  // closer than `near` startles it (140 S react), a click closer than `click` does (260 S react).
  // Pointer and click distances are fractions of these, so a run means the same at any tuning.
  // (S is the body scale: ML = 46 S.)
  const radii = (ML, react) => ({ near: 140 * (ML / 46) * react, click: 260 * (ML / 46) * react });
  const CHASE = 0.6; // a chasing pointer keeps 0.6 near from the neck: frightening, fear rising
  const at = (c, t0) => c.i === Math.round(t0 / DT);
  const inside = (c, x, y) => [Math.min(c.W, Math.max(0, x)), Math.min(c.H, Math.max(0, y))];
  // a pointer that keeps `dist` px from the body, on whatever side it already is (it starts at
  // `bearing` from the body), so the octopus is always being followed and fear stays up
  function follow(c, dist, bearing) {
    const s = c.s;
    let bx, by;
    if (!c.st.p) {
      const b = typeof bearing === "function" ? bearing(c) : bearing;
      [bx, by] = [Math.cos(b), Math.sin(b)];
    } else {
      const dx = c.st.p[0] - s.x,
        dy = c.st.p[1] - s.y,
        d = Math.hypot(dx, dy) || 1;
      [bx, by] = [dx / d, dy / d];
    }
    c.st.p = inside(c, s.x + bx * dist, s.y + by * dist);
    c.L.pointer(c.st.p[0], c.st.p[1]);
  }
  function release(c) {
    if (c.st.p) {
      c.st.p = null;
      c.L.pointer(null);
    }
  }
  // scroll by `px` over `dur` s from t0 with the given easing, as page scroll deltas per step
  function scrollRamp(c, t0, dur, px, curve) {
    const f = (t) => px * curve((t - t0) / dur);
    const d = f(c.t + DT) - f(c.t);
    if (d) c.L.scroll(d);
    c.st.scrolling = c.t >= t0 && c.t < t0 + dur;
  }
  const fling = (c, t0, px) => scrollRamp(c, t0, 0.9, px, easeOut);
  const toCenter = (c) => Math.atan2(c.H / 2 - c.s.y, c.W / 2 - c.s.x);

  // --- scenarios -------------------------------------------------------------------------------
  // place(W, H) -> [x, y, heading]; heading is octopus.js's th (the way the mantle leads;
  // -PI/2 is mantle up). film: which frames make the contact sheet: the 12 phases of the first
  // stroke that starts at or after `at` ("stroke"), or 12 frames spread over `span` s ("time");
  // align "body" turns each crop so the arms' axis points up (the mantle, unless the body is
  // arched: see armAxis()), "world" keeps the screen's frame.
  // checks: the scenario-specific checks; the arm and resting checks run everywhere.
  const UP = -Math.PI / 2;
  const SCENARIOS = [
    {
      id: "cruise",
      title: "cruise",
      about: "60 s unprovoked: waypoints, strokes, rests. The reference the others compare to.",
      seed: 1,
      secs: 60,
      place: (W, H) => [W * 0.75, H * 0.5, UP],
      drive: () => {},
      film: { kind: "stroke", at: 10, align: "body" },
      checks: ["arch"],
    },
    {
      id: "click",
      title: "single click",
      about:
        "Resting, then one click off its side at 2 s (half the click radius away): one fright, then calm.",
      seed: 2,
      secs: 12,
      place: (W, H) => [W * 0.75, H * 0.5, UP],
      drive: (c) => {
        if (at(c, 2)) {
          const x = c.s.x + 0.86 * 0.5 * c.click,
            y = c.s.y + 0.51 * 0.5 * c.click;
          c.L.click(x, y);
          c.st.mark = [x, y];
        }
      },
      film: { kind: "stroke", at: 2, align: "body" },
      checks: [],
    },
    {
      id: "chase-short",
      title: "short chase",
      about: "A pointer follows it for 3 s (2-5 s), 0.6 of the fright radius off, then leaves.",
      seed: 3,
      secs: 14,
      place: (W, H) => [W * 0.72, H * 0.55, UP],
      drive: (c) => {
        if (c.t >= 2 && c.t < 5) follow(c, CHASE * c.near, Math.PI * 0.75);
        else release(c);
      },
      film: { kind: "stroke", at: 3.2, align: "body" },
      checks: ["reach", "lateSpread"],
    },
    {
      id: "chase-long",
      title: "long chase",
      about:
        "A pointer follows it for 28 s (2-30 s), 0.6 of the fright radius off: fear pinned at 1 for over 20 s.",
      seed: 4,
      secs: 36,
      place: (W, H) => [W * 0.7, H * 0.5, UP],
      drive: (c) => {
        if (c.t >= 2 && c.t < 30) follow(c, CHASE * c.near, Math.PI * 0.75);
        else release(c);
      },
      film: { kind: "stroke", at: 18, align: "body" },
      checks: ["reach", "lateSpread", "fullFearClose"],
    },
    ...[
      ["tl", "top left", () => [130, 130]],
      ["tr", "top right", (W) => [W - 130, 130]],
      ["bl", "bottom left", (_W, H) => [130, H - 130]],
      ["br", "bottom right", (W, H) => [W - 130, H - 130]],
    ].map(([k, name, xy], n) => ({
      id: "corner-" + k,
      title: "corner chase, " + name,
      about: `Starts 130 px from the ${name} corner; a pointer between it and the middle of the screen follows 0.6 of the fright radius off for 8 s (1-9 s), herding it into the corner.`,
      seed: 5 + n,
      secs: 13,
      place: (W, H) => [...xy(W, H), UP],
      drive: (c) => {
        if (c.t >= 1 && c.t < 9) follow(c, CHASE * c.near, toCenter);
        else release(c);
      },
      film: { kind: "stroke", at: 4, align: "body" },
      checks: ["reach", "lateSpread", "fullFearClose"],
    })),
    {
      id: "scroll-slow",
      title: "slow scroll",
      about: "Reading speed: 1800 px down over 7 s (1-8 s), eased in and out.",
      seed: 9,
      secs: 14,
      place: (W, H) => [W * 0.75, H * 0.5, -0.3],
      drive: (c) => scrollRamp(c, 1, 7, 1800, ease),
      film: { kind: "time", at: 1, span: 8, align: "world" },
      checks: [],
    },
    {
      id: "scroll-fling",
      title: "fling down and back",
      about: "4000 px down in 0.9 s at 1 s, back up at 3.1 s.",
      seed: 10,
      secs: 10,
      place: (W, H) => [W * 0.75, H * 0.5, -0.3],
      drive: (c) => {
        fling(c, 1, 4000);
        if (!c.st.scrolling) fling(c, 3.1, -4000);
      },
      film: { kind: "time", at: 0.8, span: 4.4, align: "world" },
      checks: [],
    },
    {
      id: "rest-top",
      title: "rest at the top",
      about: "Near the top edge; flung down the page and back (0.5 s, 2.6 s), then left to rest.",
      seed: 11,
      secs: 24,
      place: (W) => [W * 0.7, 100, -0.3],
      drive: (c) => {
        fling(c, 0.5, 4000);
        if (!c.st.scrolling) fling(c, 2.6, -4000);
      },
      film: { kind: "time", at: 0.5, span: 22, align: "world" },
      checks: [],
    },
    {
      id: "rest-bottom",
      title: "rest at the bottom",
      about: "Near the bottom edge; flung to the end of the page at 0.5 s, then left to rest.",
      seed: 12,
      secs: 24,
      place: (W, H) => [W * 0.7, H - 100, -0.3],
      drive: (c) => fling(c, 0.5, 4000),
      film: { kind: "time", at: 0.5, span: 22, align: "world" },
      checks: [],
    },
    {
      id: "flee-scroll",
      title: "scroll during a flee",
      about:
        "Chased (1-9 s, as in the long chase); flung 4000 px down at 4 s and back at 6.1 s mid-flee.",
      seed: 13,
      secs: 13,
      place: (W, H) => [W * 0.72, H * 0.5, UP],
      drive: (c) => {
        if (c.t >= 1 && c.t < 9) follow(c, CHASE * c.near, Math.PI * 0.75);
        else release(c);
        fling(c, 4, 4000);
        if (!c.st.scrolling) fling(c, 6.1, -4000);
      },
      film: { kind: "stroke", at: 4, align: "body" },
      checks: ["reach", "lateSpread"],
    },
    {
      id: "sharp-turns",
      title: "sharp turns",
      about:
        "A click straight ahead of the mantle (half the click radius) at 1.5, 4.5, 7.5 and 10.5 s: each one turns it right round.",
      seed: 14,
      secs: 14,
      place: (W, H) => [W * 0.72, H * 0.5, UP],
      drive: (c) => {
        for (const t0 of [1.5, 4.5, 7.5, 10.5])
          if (at(c, t0)) {
            const x = c.s.x + Math.cos(c.s.th) * 0.5 * c.click,
              y = c.s.y + Math.sin(c.s.th) * 0.5 * c.click;
            c.L.click(x, y);
            c.st.mark = [x, y];
          }
      },
      film: { kind: "stroke", at: 4.5, align: "body" },
      checks: ["arch"],
    },
  ];

  // --- the stage -------------------------------------------------------------------------------
  // The octopus runs in an iframe (lab/stage.html) of a fixed size, so it sees the same
  // viewport however the lab window is sized.
  let stage = null;
  async function attach(iframe, { tune = TUNE, palette = PALETTE } = {}) {
    await new Promise((r) =>
      iframe.contentWindow && iframe.contentWindow.ready
        ? r()
        : iframe.addEventListener("load", () => r(), { once: true }),
    );
    const win = iframe.contentWindow;
    const sea = await win.ready;
    if (!sea) {
      stage = { win, sea: null, unsupported: "this octopus.js has no sea.lab" };
      return stage;
    }
    win.document.documentElement.dataset.palette = palette;
    const applied = sea.set({ ...(sea.defaults || {}), ...tune });
    sea.recolor();
    const canvas = win.document.getElementById("sea");
    const s0 = sea.lab.snapshot();
    stage = {
      win,
      sea,
      canvas,
      W: s0.W,
      H: s0.H,
      tune: applied,
      palette,
      ...radii(s0.ML, applied.react ?? 1),
    };
    cache.clear();
    return stage;
  }

  // One run of a scenario: reset() starts over (seed, place), advance() is one fixed step.
  function session(sc) {
    const L = stage.sea.lab;
    let st, i, snap;
    const self = {
      reset() {
        L.pause();
        L.seed(sc.seed);
        const [x, y, th] = sc.place(stage.W, stage.H);
        L.place(x, y, th);
        L.pointer(null);
        st = {};
        i = 0;
        snap = L.snapshot();
      },
      advance() {
        sc.drive({
          t: i * DT,
          i,
          s: snap,
          L,
          st,
          W: stage.W,
          H: stage.H,
          near: stage.near,
          click: stage.click,
        });
        L.step(DT, 1);
        i++;
        snap = L.snapshot();
        return snap;
      },
      get t() {
        return i * DT;
      },
      get i() {
        return i;
      },
      get snap() {
        return snap;
      },
      get st() {
        return st;
      },
    };
    self.reset();
    return self;
  }

  // The body's bend, if this octopus.js reports one: snapshot().arch (radians, octopus-v7 on),
  // else the first numeric key that sounds like one (assumed radians too). Without one it is
  // estimated from the arms (see analyser()) and the arch check can only warn.
  const archKey = (s) =>
    typeof s.arch === "number"
      ? "arch"
      : Object.keys(s).find((k) => typeof s[k] === "number" && /bend|flex|bow|curv/i.test(k)) ||
        null;
  // octopus-v7's bent body: the mantle leans by +arch, the head turns by -ARCH_HEAD * arch about
  // the neck, and the arms hang off an axis turned by -ARCH_ARMS * arch: their roots, pose,
  // reach (the cap) and midline all use that axis, so the lab measures the arms against it too.
  // Without an arch field it is the heading itself.
  const ARCH_HEAD = 0.35,
    ARCH_ARMS = 0.6;
  const archOf = (s) => (typeof s.arch === "number" ? s.arch : 0);
  const armAxis = (s) => s.th - ARCH_ARMS * archOf(s);

  // --- measuring -------------------------------------------------------------------------------
  function analyser(s0, nSteps) {
    const { ML, W, H } = s0;
    const REACH = s0.REACH ?? 2.25;
    const nArms = s0.arms.length,
      nNodes = s0.arms[0].length / 2,
      tip = nNodes - 1,
      mid = Math.round(tip / 2),
      q34 = Math.round((tip * 3) / 4);
    const side = (k) => (k < nArms / 2 ? -1 : 1);
    const aKey = archKey(s0);
    const series = [];
    const strokes = [];
    const rests = [];
    const tipSpeeds = [];
    const archTurn = [];
    const archAll = [],
      wAll = [];
    const jerks = [];
    let prevBody = null,
      prev = null,
      prevA = null,
      prevV = null,
      prevW = null;
    let stroke = null,
      fleeRun = 0,
      rest = null,
      firstRest = true;
    const m = {
      frames: 0,
      closingFrames: 0,
      stallArmFrames: 0,
      closeArmFrames: 0,
      crossMid: -Infinity,
      cross34: -Infinity,
      crossTip: -Infinity,
      nodeMax: 0,
      flickFrames: 0,
      flickAt: null,
      selfCrossFrames: 0,
      sideCrossFrames: 0,
      sideCrossClosing: 0,
      tangleChecked: 0,
      angAccMax: 0,
      offscreen: 0,
      offscreenRest: 0,
      facingS: 0,
      facingRunMax: 0,
      facingRun: 0,
      upsideEdgeRest: 0,
      upsideLateRest: 0,
      upsideRest: 0,
      restFrames: 0,
      minEdge: { left: Infinity, right: Infinity, top: Infinity, bottom: Infinity },
      crossMidAt: null,
      cross34At: null,
      crossTipAt: null,
      upsideEdgeAt: null,
      fearOneS: 0,
      stillFrames: 0,
      stillRun: 0,
      stillRunMax: 0,
      stillFromStart: true,
      jerkArmMax: 0,
      jerkBodyMax: 0,
    };
    const jerkArms = [];
    const restsAny = []; // every rest but the first, cut ones up to the cut
    const body = new Float64Array(nArms * nNodes * 2);
    // per step: flags, and the traced points in the screen frame (x, y, th, then each arm's mid,
    // 3/4 and tip, then the mantle top and the head)
    const HW = 3 + nArms * 6 + 4;
    const hist = new Float32Array(nSteps * HW);
    const flags = new Uint16Array(nSteps);
    const events = [];
    const open = {};
    let noArchRun = 0;
    function flag(i, kind, value, limit, ratio) {
      flags[i] |= FLAGS[kind][0];
      const e = open[kind];
      if (e && i - e.last <= 2) {
        e.last = i;
        if (ratio > e.ratio) Object.assign(e, { ratio, value, step: i });
      } else {
        open[kind] = { kind, first: i, last: i, step: i, value, limit, ratio };
        events.push(open[kind]);
      }
    }

    function frame(s, i) {
      // f: the arms' axis (lateral offsets, spread, the midline, the cap, tip speeds); h: the
      // heading, the way the mantle leads (edges, upside down)
      const t = s.t,
        ax = armAxis(s),
        f0 = Math.cos(ax),
        f1 = Math.sin(ax),
        h0 = Math.cos(s.th),
        h1 = Math.sin(s.th);
      const swim = s.mode === "swim";
      const resting = s.mode === "drift" && !s.hurry;
      const closing = swim && (s.shut ?? 0) >= 0.5;
      m.frames++;
      // body-frame arm points
      let spread = 0,
        tipMax = 0,
        tipSum = 0,
        cx = 0,
        cy = 0,
        cn = 0;
      for (let k = 0; k < nArms; k++) {
        const p = s.arms[k];
        for (let j = 0; j < nNodes; j++) {
          const dx = p[j * 2] - s.x,
            dy = p[j * 2 + 1] - s.y;
          const a = (dx * f0 + dy * f1) / ML,
            l = (-dx * f1 + dy * f0) / ML;
          const o = (k * nNodes + j) * 2;
          body[o] = a;
          body[o + 1] = l;
          if (j >= 1) spread = Math.max(spread, Math.abs(l));
          if (j >= 1 && j <= 3) {
            cx += a;
            cy += l;
            cn++;
          }
        }
        const lt = Math.abs(body[(k * nNodes + tip) * 2 + 1]);
        tipMax = Math.max(tipMax, lt);
        tipSum += lt;
      }
      const tipMean = tipSum / nArms;

      // traced points, and their jerk from the last four steps
      const ho = i * HW;
      hist[ho] = s.x;
      hist[ho + 1] = s.y;
      hist[ho + 2] = ax;
      for (let k = 0; k < nArms; k++) {
        const p = s.arms[k];
        for (const [n, j] of [mid, q34, tip].entries()) {
          hist[ho + 3 + k * 6 + n * 2] = p[j * 2];
          hist[ho + 3 + k * 6 + n * 2 + 1] = p[j * 2 + 1];
        }
      }
      const mt = ho + 3 + nArms * 6;
      const mA = s.th + archOf(s),
        hA = s.th - ARCH_HEAD * archOf(s);
      hist[mt] = s.x + Math.cos(mA) * ML * 1.19;
      hist[mt + 1] = s.y + Math.sin(mA) * ML * 1.19;
      hist[mt + 2] = s.x - Math.cos(hA) * ML * 0.14;
      hist[mt + 3] = s.y - Math.sin(hA) * ML * 0.14;
      // over steps JH apart (1/30 s): what a viewer can see at 60 fps, not the solver's own
      // step-to-step texture
      if (i >= 3 * JH) {
        let ja = 0,
          jb = 0;
        const d = JH * HW,
          h3 = (JH * DT) ** 3;
        for (let c = 3; c < HW; c += 2) {
          const J = (o) =>
            (hist[ho + o] -
              3 * hist[ho - d + o] +
              3 * hist[ho - 2 * d + o] -
              hist[ho - 3 * d + o]) /
            h3 /
            ML;
          const j = Math.hypot(J(c), J(c + 1));
          if (c < mt - ho) ja = Math.max(ja, j);
          else jb = Math.max(jb, j);
        }
        if (ja > T.jerkArm) flag(i, "jerkArm", ja, T.jerkArm, ja / T.jerkArm);
        if (jb > T.jerkBody) flag(i, "jerkBody", jb, T.jerkBody, jb / T.jerkBody);
        m.jerkArmMax = Math.max(m.jerkArmMax, ja);
        m.jerkBodyMax = Math.max(m.jerkBodyMax, jb);
        if (i % 2 === 0) jerkArms.push(ja);
      }
      if (s.grip > 0.95 && spread > REACH * T.reachTol)
        flag(i, "cap", spread, REACH, spread / REACH);

      // speeds of every point relative to the body frame
      let nodeMax = 0;
      if (prevBody) {
        for (let k = 0; k < nArms; k++)
          for (let j = 1; j < nNodes; j++) {
            const o = (k * nNodes + j) * 2;
            const v = Math.hypot(body[o] - prevBody[o], body[o + 1] - prevBody[o + 1]) / DT;
            if (v > nodeMax) nodeMax = v;
            if (j === tip) {
              tipSpeeds.push(v);
              if (closing) {
                m.closeArmFrames++;
                if (Math.abs(body[o + 1]) > T.stallOpen && v < T.stallSpeed) {
                  m.stallArmFrames++;
                  flag(i, "stall", v, T.stallSpeed, 1 + Math.abs(body[o + 1]));
                }
              }
            }
          }
        if (nodeMax > m.nodeMax) m.nodeMax = nodeMax;
        if (nodeMax > T.flick) {
          flag(i, "flick", nodeMax, T.flick, nodeMax / T.flick);
          m.flickFrames++;
          if (!m.flickAt) m.flickAt = r3(t);
        }
      }

      // midline: how far past the axis each arm's mid, 3/4 and tip get while closing
      if (closing) {
        m.closingFrames++;
        for (let k = 0; k < nArms; k++) {
          const sg = side(k);
          const past = (j) => -sg * body[(k * nNodes + j) * 2 + 1];
          if (past(mid) > m.crossMid) [m.crossMid, m.crossMidAt] = [past(mid), r3(t)];
          if (past(q34) > m.cross34) [m.cross34, m.cross34At] = [past(q34), r3(t)];
          if (past(tip) > m.crossTip) [m.crossTip, m.crossTipAt] = [past(tip), r3(t)];
          const pm = Math.max(past(mid), past(q34));
          if (pm > T.midCross) flag(i, "midline", pm, T.midCross, 1 + pm / T.tipCross);
          if (past(tip) > T.tipCross)
            flag(i, "midline", past(tip), T.tipCross, past(tip) / T.tipCross);
        }
      }

      // tangles, every other frame
      if (i % 2 === 0) {
        m.tangleChecked++;
        let self = false,
          cross = false;
        const P = s.arms;
        for (let k = 0; k < nArms && !self; k++) {
          const p = P[k];
          for (let a = 1; a < tip && !self; a++)
            for (let b = a + 2; b < tip; b++)
              if (
                segX(
                  p[a * 2],
                  p[a * 2 + 1],
                  p[a * 2 + 2],
                  p[a * 2 + 3],
                  p[b * 2],
                  p[b * 2 + 1],
                  p[b * 2 + 2],
                  p[b * 2 + 3],
                )
              ) {
                self = true;
                break;
              }
        }
        for (let k = 0; k < nArms && !cross; k++)
          for (let k2 = k + 1; k2 < nArms && !cross; k2++) {
            // the same side of the body and the same layer (octopus.js draws odd arms behind)
            if (side(k) !== side(k2) || k % 2 !== k2 % 2) continue;
            const p = P[k],
              q = P[k2];
            for (let a = 1; a < tip && !cross; a++)
              for (let b = 1; b < tip; b++)
                if (
                  segX(
                    p[a * 2],
                    p[a * 2 + 1],
                    p[a * 2 + 2],
                    p[a * 2 + 3],
                    q[b * 2],
                    q[b * 2 + 1],
                    q[b * 2 + 2],
                    q[b * 2 + 3],
                  )
                ) {
                  cross = true;
                  break;
                }
          }
        if (self) m.selfCrossFrames++;
        if (cross) {
          m.sideCrossFrames++;
          if (closing) m.sideCrossClosing++;
        }
        if (self || (cross && closing)) flag(i, "tangle", self ? 1 : 0, 0, 1);
      }

      // the body path: jerk, and how sharply the turn rate changes
      const v = Math.hypot(s.vx, s.vy) / ML;
      if (v < T.stillSpeed) {
        if (!m.stillFromStart) m.stillFrames++;
        m.stillRun += DT;
        if (!m.stillFromStart) m.stillRunMax = Math.max(m.stillRunMax, m.stillRun);
      } else {
        m.stillRun = 0;
        m.stillFromStart = false;
      }
      const vx = s.vx / ML,
        vy = s.vy / ML;
      if (prevV) {
        const ax = (vx - prevV[0]) / DT,
          ay = (vy - prevV[1]) / DT;
        if (prevA) jerks.push(Math.hypot(ax - prevA[0], ay - prevA[1]) / DT);
        prevA = [ax, ay];
      }
      prevV = [vx, vy];
      if (prevW != null) {
        const aa = Math.abs(s.w - prevW) / DT;
        m.angAccMax = Math.max(m.angAccMax, aa);
        if (aa > T.headingSnap) flag(i, "snap", aa, T.headingSnap, aa / T.headingSnap);
      }
      prevW = s.w;

      // bend in degrees: the snapshot's own (radians), or estimated as the angle between the
      // axis (pointing back) and the line from the neck to the arms' first three nodes
      const arch = ((aKey ? s[aKey] : Math.atan2(cy / cn, -cx / cn)) * 180) / Math.PI;
      if (swim) {
        archAll.push(arch);
        wAll.push(s.w);
        if (Math.abs(s.w) > T.archTurnW) archTurn.push(Math.abs(arch));
      }
      noArchRun = Math.abs(s.w) > T.archTurnW && Math.abs(arch) < T.noArchDeg ? noArchRun + DT : 0;
      if (noArchRun > T.noArchFor) flag(i, "noArch", Math.abs(arch), T.noArchDeg, 1 + noArchRun);

      // edges and heading
      const d = { left: s.x / ML, right: (W - s.x) / ML, top: s.y / ML, bottom: (H - s.y) / ML };
      for (const k in d) m.minEdge[k] = Math.min(m.minEdge[k], d[k]);
      const mx = s.x + h0 * ML * 1.15,
        my = s.y + h1 * ML * 1.15;
      const off = s.x < 0 || s.x > W || s.y < 0 || s.y > H || mx < 0 || mx > W || my < 0 || my > H;
      const facing =
        (d.left < T.edgeNear && -h0 > T.facingCos) ||
        (d.right < T.edgeNear && h0 > T.facingCos) ||
        (d.top < T.edgeNear && -h1 > T.facingCos) ||
        (d.bottom < T.edgeNear && h1 > T.facingCos);
      if (off) m.offscreen++;
      if (facing) m.facingS += DT;
      const upside = h1 > T.upsideSin;
      if (resting) {
        m.restFrames++;
        if (off) m.offscreenRest++;
        m.facingRun = facing ? m.facingRun + DT : 0;
        m.facingRunMax = Math.max(m.facingRunMax, m.facingRun);
        if (upside) {
          m.upsideRest++;
          if (d.top < T.edgeZone || d.bottom < T.edgeZone) {
            flag(i, "upside", h1, T.upsideSin, 2);
            m.upsideEdgeRest++;
            m.upsideEdgeAt ??= r3(t);
          }
          if (rest && t - rest.t0 > T.upsideGrace) m.upsideLateRest++;
        }
      } else m.facingRun = 0;
      if (s.fear >= 0.999) m.fearOneS += DT;

      // strokes: one starts when swimming begins or the phase wraps
      const started = swim && (!prev || prev.mode !== "swim" || s.phase < prev.phase - 0.3);
      if (stroke && (started || !swim)) {
        stroke.t1 = r3(t);
        strokes.push(finishStroke(stroke));
        stroke = null;
      }
      // flee strokes are counted from the first whole stroke of a fright
      if (!s.hurry) fleeRun = 0;
      if (started) {
        stroke = {
          n: strokes.length,
          t0: r3(t),
          hurry: s.hurry,
          hurryAll: s.hurry, // fleeing from start to end (not the stroke that calms down)
          flee: s.hurry ? fleeRun++ : -1,
          fear0: s.fear,
          fearMax: s.fear,
          period: s.period,
          v: [],
          spreadMax: 0,
          tipMax: 0,
          closeMean: Infinity,
          closeMax: Infinity,
        };
      }
      if (stroke) {
        stroke.v.push(v);
        stroke.fearMax = Math.max(stroke.fearMax, s.fear);
        stroke.hurry ||= s.hurry;
        stroke.hurryAll &&= s.hurry;
        stroke.spreadMax = Math.max(stroke.spreadMax, spread);
        stroke.tipMax = Math.max(stroke.tipMax, tipMax);
        stroke.closeMean = Math.min(stroke.closeMean, tipMean);
        stroke.closeMax = Math.min(stroke.closeMax, tipMax);
      }

      // rests: from the end of one swim to the start of the next, unless a fright cut it short
      if (resting && !rest) rest = { t0: t, first: firstRest, cut: false };
      if (rest && s.hurry && !rest.cut) {
        rest.cut = true;
        if (!rest.first) restsAny.push(r3(t - rest.t0));
        rest.first = true; // counted already
      }
      if (rest && swim) {
        if (!rest.first && !rest.cut) rests.push(r3(t - rest.t0));
        if (!rest.first) restsAny.push(r3(t - rest.t0));
        rest = null;
        firstRest = false;
      }

      if (i % SERIES_EVERY === 0)
        series.push([
          r3(t),
          r3(v),
          r3(spread),
          r3(tipMean),
          r3(s.fear),
          Math.round((wrapA(s.th - UP) * 180) / Math.PI),
          swim ? (s.hurry ? 2 : 1) : s.hurry ? 2 : 0,
          r3(arch),
          r3(s.w),
          r3(nodeMax),
          Math.round(s.x),
          Math.round(s.y),
        ]);

      prevBody = prevBody || new Float64Array(body.length);
      prevBody.set(body);
      prev = s;
    }

    function finishStroke(k) {
      const { v, ...rest } = k;
      return {
        ...rest,
        fear0: r3(k.fear0),
        fearMax: r3(k.fearMax),
        period: r3(k.period),
        vMean: r3(mean(v)),
        vPeak: r3(Math.max(...v)),
        spreadMax: r3(k.spreadMax),
        tipMax: r3(k.tipMax),
        closeMean: r3(k.closeMean),
        closeMax: r3(k.closeMax),
      };
    }

    function finish() {
      if (stroke && stroke.v.length) strokes.push({ ...finishStroke(stroke), partial: true });
      const fin = (x) => (Number.isFinite(x) ? r3(x) : null);
      const metrics = {
        frames: m.frames,
        strokes: strokes.length,
        fleeStrokes: strokes.filter((k) => k.hurry).length,
        vMean: fin(mean(series.map((r) => r[1]))),
        vPeak: fin(Math.max(0, ...strokes.map((k) => k.vPeak))),
        spreadMax: fin(Math.max(0, ...series.map((r) => r[2]))),
        tipP50: fin(quant(tipSpeeds, 0.5)),
        tipP99: fin(quant(tipSpeeds, 0.99)),
        tipMax: fin(Math.max(0, ...tipSpeeds)),
        nodeMax: fin(m.nodeMax),
        flickFrames: m.flickFrames,
        flickAt: m.flickAt,
        stallFrac: fin(m.closeArmFrames ? m.stallArmFrames / m.closeArmFrames : 0),
        closingFrames: m.closingFrames,
        crossMid: m.closingFrames ? fin(m.crossMid) : null,
        cross34: m.closingFrames ? fin(m.cross34) : null,
        crossTip: m.closingFrames ? fin(m.crossTip) : null,
        crossMidAt: m.crossMidAt,
        cross34At: m.cross34At,
        crossTipAt: m.crossTipAt,
        selfCrossFrac: fin(m.selfCrossFrames / Math.max(1, m.tangleChecked)),
        sideCrossFrac: fin(m.sideCrossFrames / Math.max(1, m.tangleChecked)),
        jerkP99: fin(quant(jerks, 0.99)),
        jerkMax: fin(Math.max(0, ...jerks)),
        jerkArmP99: fin(quant(jerkArms, 0.99)),
        jerkArmMax: fin(m.jerkArmMax),
        jerkBodyMax: fin(m.jerkBodyMax),
        angAccMax: fin(m.angAccMax),
        restS: fin(m.restFrames * DT),
        upsideRestS: fin(m.upsideRest * DT),
        upsideEdgeRestS: fin(m.upsideEdgeRest * DT),
        upsideEdgeAt: m.upsideEdgeAt,
        upsideLateRestS: fin(m.upsideLateRest * DT),
        offscreenS: fin(m.offscreen * DT),
        offscreenRestS: fin(m.offscreenRest * DT),
        facingEdgeS: fin(m.facingS),
        facingEdgeRestRunMax: fin(m.facingRunMax),
        minEdge: Object.fromEntries(Object.entries(m.minEdge).map(([k, x]) => [k, fin(x)])),
        fearOneS: fin(m.fearOneS),
        stillFrac: fin(m.stillFrames / Math.max(1, m.frames)),
        stillRunMax: fin(m.stillRunMax),
        restLongest: restsAny.length ? Math.max(...restsAny) : null,
        speedSpark: spark(series.map((r) => r[1])),
        archSource: aKey ? "snapshot." + aKey : "estimated",
        archTurnMeanDeg: fin(mean(archTurn)),
        archTurnFrames: archTurn.length,
        archTurnCorr: fin(corr(archAll, wAll)),
        rests,
      };
      return {
        metrics,
        strokes,
        rests,
        series,
        seriesCols: [
          "t",
          "speed",
          "spread",
          "tipMean",
          "fear",
          "heading",
          "mode",
          "arch",
          "turn",
          "nodeSpeed",
          "x",
          "y",
        ],
        ML,
        REACH,
        flags: summariseFlags(),
        // not in the report: the raw per-step data for flipbooks and traces
        raw: { flags, hist, HW, nArms, n: m.frames },
      };
    }
    // every flag kind: frames flagged, number of separate events, and its worst three events
    function summariseFlags() {
      const ev = events.map((e) => ({
        kind: e.kind,
        code: FLAGS[e.kind][1],
        t0: r3(e.first * DT),
        t1: r3(e.last * DT),
        step: e.step,
        t: r3(e.step * DT),
        value: r3(e.value),
        limit: e.limit,
        ratio: r3(e.ratio),
      }));
      const counts = {};
      for (const k in FLAGS) {
        let n = 0;
        for (let i = 0; i < m.frames; i++) if (flags[i] & FLAGS[k][0]) n++;
        counts[k] = { frames: n, events: ev.filter((e) => e.kind === k).length };
      }
      const worst = Object.keys(FLAGS).flatMap((k) =>
        ev
          .filter((e) => e.kind === k)
          .sort((a, b) => b.ratio - a.ratio)
          .slice(0, 3),
      );
      return {
        counts,
        worst,
        events: ev.length > 400 ? ev.slice(0, 400) : ev,
        eventsTotal: ev.length,
      };
    }
    return { frame, finish, flags };
  }

  // --- checks ----------------------------------------------------------------------------------
  const check = (id, label, status, value, limit, note) => ({
    id,
    label,
    status,
    value: Number.isFinite(value) ? r3(value) : value,
    limit,
    note: note || "",
  });
  const leq = (v, lim) => (v == null || !Number.isFinite(v) ? "n/a" : v <= lim ? "pass" : "fail");

  function judge(sc, r, cruise) {
    const M = r.metrics,
      out = [];
    const want = new Set(sc.checks);
    // spread across a flee: strokes 3+ (flee index 2+) against the cap and against strokes 1-2
    if (want.has("reach") || want.has("lateSpread")) {
      const runs = [];
      for (const k of r.strokes) {
        if (k.flee === 0) runs.push([]);
        if (k.flee >= 0 && runs.length) runs.at(-1).push(k);
      }
      const isLate = (k) => k.flee >= 2 && k.hurryAll && !k.partial;
      const late = runs.flatMap((run) => run.filter(isLate));
      if (want.has("reach")) {
        const v = late.length ? Math.max(...late.map((k) => k.spreadMax)) : null;
        out.push(
          check(
            "reach",
            "flee strokes 3+ stay within REACH",
            v == null ? "n/a" : leq(v, r.REACH * T.reachTol),
            v,
            `<= ${r3(r.REACH * T.reachTol)} ML`,
            late.length ? `${late.length} late strokes` : "no third flee stroke",
          ),
        );
      }
      if (want.has("lateSpread")) {
        let worst = null,
          note = "";
        for (const run of runs) {
          const early = run.filter((k) => k.flee < 2);
          const rest = run.filter(isLate);
          if (early.length < 2 || !rest.length) continue;
          const e = mean(early.map((k) => k.spreadMax));
          for (const k of rest) {
            const dev = k.spreadMax / e - 1;
            if (worst == null || dev > worst) {
              worst = dev;
              note = `stroke ${k.n} (flee #${k.flee + 1}) ${k.spreadMax} vs strokes 1-2 ${r3(e)} ML`;
            }
          }
        }
        out.push(
          check(
            "lateSpread",
            "late flee strokes open no wider than strokes 1-2",
            worst == null ? "n/a" : leq(worst, T.lateSpreadBand),
            worst,
            `<= +${T.lateSpreadBand * 100}%`,
            note,
          ),
        );
      }
    }
    if (want.has("fullFearClose")) {
      const full = r.strokes.filter((k) => k.fear0 >= T.fullFear && !k.partial);
      const base = cruise
        ? cruise.strokes.filter((k) => !k.hurry && !k.partial).map((k) => k.closeMean)
        : [];
      const ratio =
        full.length && base.length ? mean(full.map((k) => k.closeMean)) / mean(base) : null;
      out.push(
        check(
          "fullFearClose",
          "full-fear strokes close like cruise",
          ratio == null ? "n/a" : leq(ratio, T.fullFearCloseRatio),
          ratio,
          `<= ${T.fullFearCloseRatio}× cruise`,
          full.length
            ? `${full.length} strokes at fear >= ${T.fullFear}: tips ${r3(mean(full.map((k) => k.closeMean)))} ML off the axis at their closest, cruise ${r3(mean(base))}`
            : "no stroke at full fear",
        ),
      );
    }
    // the arm checks, wherever there is a close
    const hasClose = M.closingFrames > 0;
    out.push(
      check(
        "stall",
        "tips keep moving through close/glide",
        hasClose ? leq(M.stallFrac, T.stallFrac) : "n/a",
        M.stallFrac,
        `< ${T.stallFrac * 100}% of tip-frames`,
        `a tip > ${T.stallOpen} ML out moving < ${T.stallSpeed} ML/s`,
      ),
    );
    const midV = hasClose ? Math.max(M.crossMid, M.cross34) : null;
    out.push(
      check(
        "midline",
        "mid and 3/4 points stay on their side while closing",
        hasClose ? leq(midV, T.midCross) : "n/a",
        midV,
        `<= ${T.midCross} ML past`,
        hasClose
          ? `mid ${M.crossMid} at ${M.crossMidAt} s, 3/4 ${M.cross34} at ${M.cross34At} s`
          : "",
      ),
    );
    out.push(
      check(
        "tipCross",
        "tips cross the midline only a little",
        hasClose ? leq(M.crossTip, T.tipCross) : "n/a",
        M.crossTip,
        `< ${T.tipCross} ML past`,
        hasClose ? `at ${M.crossTipAt} s` : "",
      ),
    );
    out.push(
      check(
        "tipP99",
        "tip speed p99 (vs body)",
        leq(M.tipP99, T.tipP99),
        M.tipP99,
        `< ${T.tipP99} ML/s`,
      ),
    );
    out.push(
      check(
        "flick",
        "no single-frame flicks",
        leq(M.nodeMax, T.flick),
        M.nodeMax,
        `< ${T.flick} ML/s any point`,
        M.flickFrames ? `${M.flickFrames} frames over, first at ${M.flickAt} s` : "",
      ),
    );
    // resting
    const rested = M.restS > 0;
    out.push(
      check(
        "restUpright",
        "never mantle-down resting near top/bottom",
        rested ? leq(M.upsideEdgeRestS, DT) : "n/a",
        M.upsideEdgeRestS,
        "0 s",
        `within ${T.edgeZone} ML of the top or bottom${M.upsideEdgeAt != null ? `, first at ${M.upsideEdgeAt} s` : ""}`,
      ),
    );
    out.push(
      check(
        "restUprightAnywhere",
        `rights itself within ${T.upsideGrace} s of resting`,
        !rested ? "n/a" : M.upsideLateRestS <= DT ? "pass" : "warn",
        M.upsideLateRestS,
        "0 s",
        "warning only: anywhere on screen",
      ),
    );
    out.push(
      check(
        "onScreen",
        "never off screen while resting",
        rested ? leq(M.offscreenRestS, 0) : "n/a",
        M.offscreenRestS,
        "0 s",
        M.offscreenS ? `off screen ${M.offscreenS} s in all` : "",
      ),
    );
    out.push(
      check(
        "facingEdge",
        "never stuck facing an edge while resting",
        rested ? leq(M.facingEdgeRestRunMax, T.facingMax) : "n/a",
        M.facingEdgeRestRunMax,
        `<= ${T.facingMax} s at a time`,
        `within ${T.edgeNear} ML, mantle within 60° of it`,
      ),
    );
    if (want.has("arch")) {
      const est = M.archSource === "estimated";
      const ok =
        M.archTurnFrames > 0 &&
        M.archTurnMeanDeg >= T.archMinDeg &&
        Math.abs(M.archTurnCorr) >= T.archCorr;
      out.push(
        check(
          "arch",
          "turns show a body arch",
          !M.archTurnFrames ? "n/a" : ok ? "pass" : est ? "warn" : "fail",
          M.archTurnMeanDeg,
          `>= ${T.archMinDeg}°, |corr| >= ${T.archCorr}`,
          `${M.archSource}; corr with turn rate ${M.archTurnCorr}`,
        ),
      );
    }
    out.push(
      check(
        "still",
        "never stands still for long",
        leq(M.stillRunMax, T.stillMax),
        M.stillRunMax,
        `<= ${T.stillMax} s below ${T.stillSpeed} ML/s`,
        `still ${r3(M.stillFrac * 100)}% of the time; the stillness from t = 0 doesn't count (here or in that share)`,
      ),
    );
    out.push(
      check(
        "selfCross",
        "arms don't cross themselves",
        M.selfCrossFrac <= T.selfCross ? "pass" : "warn",
        M.selfCrossFrac,
        `<= ${T.selfCross * 100}% of frames`,
        `warning only; arms of one side and layer cross in ${r3(M.sideCrossFrac * 100)}% of frames`,
      ),
    );
    return out;
  }

  function statusOf(checks) {
    const s = checks.map((c) => c.status);
    return s.includes("fail") ? "fail" : s.includes("warn") ? "warn" : "pass";
  }

  // --- filmstrips -----------------------------------------------------------------------------
  const THUMB = 200,
    LABEL = 34;
  // draws the stage's canvas around the body into g at (ox, oy), size x size px: "body" turns
  // it so the arms' axis points up (REACH guides dashed), "world" keeps the screen's frame
  function drawCrop(g, ox, oy, size, snap, align, guides = true) {
    const CROP = 7.25 * snap.ML; // world px around the neck
    const cv = stage.canvas,
      k = cv.width / stage.W;
    const sc = size / CROP;
    g.save();
    g.fillStyle = "#171716";
    g.fillRect(ox, oy, size, size);
    g.beginPath();
    g.rect(ox, oy, size, size);
    g.clip();
    if (align === "body") {
      g.translate(ox + size / 2, oy + size * 0.32);
      g.scale(sc, sc);
      if (guides) {
        g.strokeStyle = "rgba(240,236,229,.14)";
        g.setLineDash([4, 6]);
        g.lineWidth = 1 / sc;
        const R = (snap.REACH ?? 2.25) * snap.ML;
        for (const x of [-R, R]) {
          g.beginPath();
          g.moveTo(x, -CROP);
          g.lineTo(x, CROP);
          g.stroke();
        }
        g.strokeStyle = "rgba(240,236,229,.08)";
        g.beginPath();
        g.moveTo(0, -CROP);
        g.lineTo(0, CROP);
        g.stroke();
        g.setLineDash([]);
      }
      g.rotate(-Math.PI / 2 - armAxis(snap));
    } else {
      g.translate(ox + size / 2, oy + size / 2);
      g.scale(sc, sc);
      // the screen edges, when in view
      g.strokeStyle = "rgba(229,129,63,.4)";
      g.lineWidth = 2 / sc;
      g.strokeRect(-snap.x, -snap.y, stage.W, stage.H);
    }
    g.translate(-snap.x, -snap.y);
    g.scale(1 / k, 1 / k);
    g.drawImage(cv, 0, 0);
    g.restore();
  }
  function crop(snap, align, size = THUMB, label = LABEL) {
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size + label;
    const g = c.getContext("2d");
    g.fillStyle = "#171716";
    g.fillRect(0, 0, c.width, c.height);
    drawCrop(g, 0, 0, size, snap, align);
    return c;
  }
  function label(c, lines, mark) {
    const g = c.getContext("2d");
    g.font = '10px "Geist Mono", ui-monospace, monospace';
    g.fillStyle = "rgba(240,236,229,.62)";
    lines.forEach((s, n) => g.fillText(s, 6, THUMB + 13 + n * 13));
    if (mark) {
      g.fillStyle = "#e5813f";
      g.fillRect(0, 0, c.width, 2);
    }
  }
  const tipSpreadOf = (s) => {
    const f0 = Math.cos(armAxis(s)),
      f1 = Math.sin(armAxis(s));
    let m = 0;
    for (const p of s.arms) {
      const j = p.length - 2;
      m = Math.max(m, Math.abs(-(p[j] - s.x) * f1 + (p[j + 1] - s.y) * f0));
    }
    return m / s.ML;
  };
  function thumb(s, align) {
    const c = crop(s, align);
    const v = Math.hypot(s.vx, s.vy) / s.ML;
    const hd = Math.round((wrapA(s.th - UP) * 180) / Math.PI);
    label(c, [
      `${s.t.toFixed(2)}s p.${String(Math.round((s.phase || 0) * 100)).padStart(2, "0")} ${s.mode === "swim" ? (s.hurry ? "flee" : "swim") : "rest"} ${hd}°`,
      `v${v.toFixed(1)} f${s.fear.toFixed(2)} tip${tipSpreadOf(s).toFixed(2)}`,
    ]);
    return c;
  }

  // records thumbnails per a scenario's film spec while it runs
  const ONION = 420;
  function filmer(spec) {
    const frames = [];
    let on = false,
      k = 0,
      t0 = 0;
    const self = {
      frames,
      window: null, // [first, last] step of the filmed stroke
      onion: [], // the same moments, larger and without labels, for the onion skin
      after(s, started, i) {
        if (on && self.window) {
          if (started) on = false; // the next stroke: the filmed one is over
          else self.window[1] = i;
        }
        if (frames.length >= 12) return;
        if (spec.kind === "time") {
          while (frames.length < 12 && s.t >= spec.at + (frames.length * spec.span) / 11 - 1e-9)
            frames.push({ body: thumb(s, "body"), world: thumb(s, "world") });
          return;
        }
        if (!on) {
          if (!self.window && started && s.t >= spec.at) {
            on = true;
            t0 = s.t;
            self.window = [i, i];
          } else return;
        }
        while (k < 12 && (s.phase >= k / 12 || s.t - t0 > 6)) {
          frames.push({ body: thumb(s, "body"), world: thumb(s, "world") });
          self.onion.push(crop(s, "body", ONION, 0));
          k++;
        }
      },
    };
    return self;
  }

  // the filmed moments laid over each other, oldest faintest
  function onionSkin(sc, crops) {
    const c = document.createElement("canvas");
    c.width = ONION;
    c.height = ONION + 24;
    const g = c.getContext("2d");
    g.fillStyle = "#171716";
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = "lighten";
    crops.forEach((f, n) => {
      g.globalAlpha = 0.15 + (0.85 * (n + 1)) / crops.length;
      g.drawImage(f, 0, 0);
    });
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    g.font = '10px "Geist Mono", ui-monospace, monospace';
    g.fillStyle = "rgba(240,236,229,.6)";
    g.fillText(
      `${sc.id} · onion skin of the ${crops.length} filmstrip frames, newest brightest`,
      6,
      ONION + 15,
    );
    return c;
  }

  // --- trajectory traces ------------------------------------------------------------------------
  // Every arm's tip, 3/4 and mid point, the mantle top and the head, over one stroke and over the
  // sharpest 1.5 s of turning, in the body frame (mantle up) and the screen frame. Dots are
  // single steps (1/120 s), so their spacing is speed; red rings mark flagged steps.
  const TRACE_COLORS = [
    ["tip", "#e5813f"],
    ["3/4", "#8db3da"],
    ["mid", "#7cc58f"],
    ["mantle top", "#f0ece5"],
    ["head", "#d9b25c"],
  ];
  function turnWindow(raw) {
    const { hist, HW, n } = raw,
      len = Math.round(1.5 / DT);
    if (n < len + 2) return null;
    const dth = (i) => Math.abs(hist[i * HW + 2] - hist[(i - 1) * HW + 2]);
    let sum = 0,
      best = -1,
      at = 1;
    for (let i = 1; i < n; i++) {
      sum += dth(i);
      if (i > len) sum -= dth(i - len);
      if (i >= len && sum > best) [best, at] = [sum, i - len + 1];
    }
    return best > 0.3 ? [at, at + len - 1] : null;
  }
  function tracePanel(g, ox, oy, size, raw, from, to, frame, title, ML) {
    const { hist, HW, nArms, flags } = raw;
    g.save();
    g.fillStyle = "#121211";
    g.fillRect(ox, oy, size, size);
    g.beginPath();
    g.rect(ox, oy, size, size);
    g.clip();
    // point class c (tip, 3/4, mid, mantle top, head) of arm k at step i
    const P = (i, c, k) => {
      const o = i * HW;
      const off = c < 3 ? 3 + k * 6 + (2 - c) * 2 : 3 + nArms * 6 + (c - 3) * 2;
      const x = hist[o + off],
        y = hist[o + off + 1];
      if (frame === "world") return [x, y];
      const th = hist[o + 2],
        dx = x - hist[o],
        dy = y - hist[o + 1];
      // mantle up: forward -> -y, the +n side -> +x
      return [-dx * Math.sin(th) + dy * Math.cos(th), -(dx * Math.cos(th) + dy * Math.sin(th))];
    };
    let fit;
    if (frame === "body") {
      const sc = size / (7.25 * ML);
      fit = ([x, y]) => [ox + size / 2 + x * sc, oy + size * 0.32 + y * sc];
      g.strokeStyle = "rgba(240,236,229,.1)";
      g.beginPath();
      g.moveTo(ox + size / 2, oy);
      g.lineTo(ox + size / 2, oy + size);
      g.stroke();
    } else {
      let x0 = Infinity,
        y0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity;
      for (let i = from; i <= to; i++)
        for (let c = 0; c < 5; c++)
          for (let k = 0; k < (c < 3 ? nArms : 1); k++) {
            const [x, y] = P(i, c, k);
            x0 = Math.min(x0, x);
            y0 = Math.min(y0, y);
            x1 = Math.max(x1, x);
            y1 = Math.max(y1, y);
          }
      const sc = (size - 30) / Math.max(x1 - x0, y1 - y0, 1);
      const cx = (x0 + x1) / 2,
        cy = (y0 + y1) / 2;
      fit = ([x, y]) => [ox + size / 2 + (x - cx) * sc, oy + size / 2 + (y - cy) * sc];
    }
    for (let c = 4; c >= 0; c--) {
      const col = TRACE_COLORS[c][1];
      for (let k = 0; k < (c < 3 ? nArms : 1); k++) {
        g.strokeStyle = col;
        g.globalAlpha = 0.5;
        g.lineWidth = 1;
        g.beginPath();
        for (let i = from; i <= to; i++) {
          const [x, y] = fit(P(i, c, k));
          if (i === from) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
        g.globalAlpha = 0.9;
        g.fillStyle = col;
        for (let i = from; i <= to; i++) {
          const [x, y] = fit(P(i, c, k));
          g.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
        }
      }
    }
    g.globalAlpha = 0.8;
    g.strokeStyle = "#e66a5c";
    for (let i = from; i <= to; i++)
      if (flags[i] & RING)
        for (let k = 0; k < nArms; k++) {
          const [x, y] = fit(P(i, 0, k));
          g.beginPath();
          g.arc(x, y, 2.5, 0, 7);
          g.stroke();
        }
    g.globalAlpha = 1;
    // where it starts
    g.fillStyle = "#f0ece5";
    const [sx, sy] = fit(P(from, 3, 0));
    g.beginPath();
    g.arc(sx, sy, 3, 0, 7);
    g.fill();
    g.font = '10px "Geist Mono", ui-monospace, monospace';
    g.fillStyle = "rgba(240,236,229,.7)";
    g.fillText(title, ox + 6, oy + 14);
    g.restore();
  }
  function traces(sc, r, strokeWin) {
    const raw = r.raw;
    let sw = strokeWin && strokeWin[1] > strokeWin[0] ? strokeWin : null;
    if (!sw) {
      const k =
        r.strokes.find((k) => !k.partial && k.t0 >= (sc.film.at || 0)) ||
        r.strokes.find((k) => !k.partial);
      if (k) sw = [Math.round(k.t0 / DT), Math.round(k.t1 / DT) - 1];
    }
    const tw = turnWindow(raw);
    const size = 460,
      gap = 6;
    const c = document.createElement("canvas");
    c.width = 4 * size + 5 * gap;
    c.height = size + 2 * gap + 22;
    const g = c.getContext("2d");
    g.fillStyle = "#171716";
    g.fillRect(0, 0, c.width, c.height);
    const panels = [
      [sw, "body", "one stroke, body frame"],
      [sw, "world", "one stroke, screen frame"],
      [tw, "body", "sharpest turn (1.5 s), body frame"],
      [tw, "world", "sharpest turn (1.5 s), screen frame"],
    ];
    g.font = '10px "Geist Mono", ui-monospace, monospace';
    panels.forEach(([w, frame, title], n) => {
      const ox = gap + n * (size + gap);
      if (!w) {
        g.fillStyle = "#121211";
        g.fillRect(ox, gap, size, size);
        g.fillStyle = "rgba(240,236,229,.5)";
        g.fillText(title + ": none in this run", ox + 6, gap + 14);
        return;
      }
      const to = Math.min(w[1], raw.n - 1);
      const span = `${(w[0] * DT).toFixed(2)}-${(to * DT).toFixed(2)} s`;
      tracePanel(g, ox, gap, size, raw, w[0], to, frame, `${title} · ${span}`, r.ML);
    });
    let x = gap;
    for (const [name, col] of [...TRACE_COLORS, ["flick / midline / cap step", "#e66a5c"]]) {
      g.fillStyle = col;
      g.fillRect(x, size + gap + 9, 10, 3);
      g.fillStyle = "rgba(240,236,229,.7)";
      g.fillText(name, x + 14, size + gap + 15);
      x += 30 + g.measureText(name).width;
    }
    g.fillText(
      `${sc.id} · dots are 1/120 s apart: gaps are speed; kinks, zig-zags and jumps are breaks`,
      x + 20,
      size + gap + 15,
    );
    return { canvas: c, stroke: sw, turn: tw };
  }

  // --- frame-by-frame flipbook ------------------------------------------------------------------
  // Every `every`-th step (2 = 60 fps), the tiled pixels around the body, mantle up, go into
  // atlases of 10 x 10 frames labelled with frame number, step, time and flags (red border when
  // a flag fired since the previous frame). onAtlas(canvas, index, firstFrame, lastFrame) takes
  // each full atlas; the canvas is reused afterwards, so copy or encode it before returning.
  const TILE = 240,
    TLAB = 14,
    COLS = 10,
    PER = 100;
  function flipbook(every, onAtlas) {
    let atlas = null,
      g = null,
      n = 0,
      idx = 0,
      first = 0;
    const meta = []; // per frame: [step, flag bits]
    const fresh = () => {
      atlas = document.createElement("canvas");
      atlas.width = COLS * TILE;
      atlas.height = (PER / COLS) * (TILE + TLAB);
      g = atlas.getContext("2d");
      g.fillStyle = "#121211";
      g.fillRect(0, 0, atlas.width, atlas.height);
    };
    return {
      meta,
      every,
      async add(s, step, bits) {
        if (!atlas) {
          fresh();
          first = n;
        }
        const k = n % PER,
          x = (k % COLS) * TILE,
          y = Math.floor(k / COLS) * (TILE + TLAB);
        drawCrop(g, x, y, TILE, s, "body", false);
        g.font = '10px "Geist Mono", ui-monospace, monospace';
        g.fillStyle = bits & MOTION ? "#e66a5c" : bits ? "#d9b25c" : "rgba(240,236,229,.55)";
        const codes = bits ? flagCodes(bits).join(" ") : "";
        g.fillText(`#${n} s${step} ${s.t.toFixed(3)}s ${codes}`, x + 4, y + TILE + 11);
        if (bits & MOTION) {
          g.strokeStyle = "#e66a5c";
          g.lineWidth = 2;
          g.strokeRect(x + 1, y + 1, TILE - 2, TILE - 2);
        }
        meta.push([step, bits]);
        n++;
        if (n % PER === 0) {
          await onAtlas(atlas, idx++, first, n - 1);
          atlas = null;
        }
      },
      async done() {
        if (atlas) await onAtlas(atlas, idx++, first, n - 1);
        atlas = null;
      },
    };
  }
  const flipEvery = (sc) => (sc.secs > 20 ? 4 : 2);

  // Some steps of a run at full size (1:1 pixels), mantle up, each with the steps 4 and 2
  // before and after it. Replays the scenario from the start.
  async function grab(id, wanted, labelFor = () => "") {
    const sc = SCENARIOS.find((s) => s.id === id);
    const ses = session(sc);
    const size = Math.round(7.25 * ses.snap.ML);
    const around = [-4, -2, 0, 2, 4];
    const need = new Set();
    for (const w of wanted) for (const d of around) need.add(w + d);
    const shots = new Map();
    const last = Math.max(...need);
    for (let i = 0; i <= last; i++) {
      const s = ses.advance();
      if (need.has(i)) shots.set(i, crop(s, "body", size, 0));
      if (i % 480 === 0) await yieldUI();
    }
    const out = new Map();
    for (const w of wanted) {
      const c = document.createElement("canvas");
      c.width = around.length * (size + 4) + 4;
      c.height = size + 30;
      const g = c.getContext("2d");
      g.fillStyle = "#121211";
      g.fillRect(0, 0, c.width, c.height);
      g.font = '11px "Geist Mono", ui-monospace, monospace';
      around.forEach((d, n) => {
        const shot = shots.get(w + d);
        if (!shot) return;
        const x = 4 + n * (size + 4);
        g.drawImage(shot, x, 4);
        g.fillStyle = d === 0 ? "#e66a5c" : "rgba(240,236,229,.55)";
        const t = ((w + d) * DT).toFixed(3);
        g.fillText(`step ${w + d} · ${t} s${d === 0 ? " · " + labelFor(w) : ""}`, x + 4, size + 20);
        if (d === 0) {
          g.strokeStyle = "#e66a5c";
          g.lineWidth = 2;
          g.strokeRect(x + 1, 5, size - 2, size - 2);
        }
      });
      out.set(w, c);
    }
    return out;
  }

  function sheet(sc, frames, ref) {
    const align = sc.film.align;
    const gap = 4,
      head = 30,
      rowH = THUMB + LABEL + 20;
    const rows =
      sc.id === "cruise" || !ref
        ? [[sc.title, frames]]
        : [
            [sc.title, frames],
            ["cruise", ref],
          ];
    const c = document.createElement("canvas");
    c.width = 12 * (THUMB + gap) + gap;
    c.height = head + rows.length * rowH;
    const g = c.getContext("2d");
    g.fillStyle = "#121211";
    g.fillRect(0, 0, c.width, c.height);
    g.font = '12px "Geist Mono", ui-monospace, monospace';
    g.fillStyle = "rgba(240,236,229,.8)";
    const what =
      sc.film.kind === "stroke"
        ? `one stroke from ${sc.film.at}s, 12 phases`
        : `${sc.film.span}s from ${sc.film.at}s, 12 frames`;
    g.fillText(
      `${sc.id} · ${what} · ${align === "body" ? "mantle up, dashed = ±REACH" : "screen frame, orange = screen edge"}`,
      gap + 2,
      19,
    );
    g.textAlign = "right";
    g.fillStyle = "rgba(240,236,229,.45)";
    g.fillText(
      `${stage.palette} · ${JSON.stringify(stage.tune).replace(/"/g, "")}`,
      c.width - gap - 2,
      19,
    );
    g.textAlign = "left";
    rows.forEach(([name, fr], r) => {
      const y = head + r * rowH;
      g.fillStyle = "rgba(240,236,229,.45)";
      g.fillText(name, gap + 2, y + 13);
      fr.forEach((f, n) => g.drawImage(f[align], gap + n * (THUMB + gap), y + 18));
      if (!fr.length) g.fillText("(no stroke in range)", gap + 120, y + 13);
    });
    return c;
  }

  // --- running ---------------------------------------------------------------------------------
  const cache = new Map(); // id -> result, for this stage load
  const yieldUI = () => new Promise((r) => setTimeout(r, 0));

  // Runs one scenario: measures every step, judges it, and (film) makes its filmstrip, onion
  // skin and traces. flip: onAtlas(canvas, index, first, last) also records every frame (60 fps,
  // 30 fps past 20 s) into flipbook atlases (see flipbook()); result.flip lists the frames.
  async function run(id, { onProgress, film = true, flip = null, keep = true } = {}) {
    if (!stage || !stage.sea) throw new Error(stage ? stage.unsupported : "no stage attached");
    const sc = SCENARIOS.find((s) => s.id === id);
    if (!sc) throw new Error("no scenario " + id);
    if (id !== "cruise" && !cache.has("cruise")) await run("cruise", { film });
    const ses = session(sc);
    const n = Math.round(sc.secs / DT);
    const an = analyser(ses.snap, n);
    const fm = filmer(sc.film);
    const fb = flip ? flipbook(flipEvery(sc), flip) : null;
    let prevSnap = ses.snap,
      hash = 0,
      bits = 0;
    for (let i = 0; i < n; i++) {
      const s = ses.advance();
      an.frame(s, i);
      const started =
        s.mode === "swim" && (prevSnap.mode !== "swim" || s.phase < prevSnap.phase - 0.3);
      if (film) fm.after(s, started, i);
      if (fb) {
        bits |= an.flags[i];
        if ((i + 1) % fb.every === 0) {
          await fb.add(s, i, bits);
          bits = 0;
        }
      }
      prevSnap = s;
      if (i === Math.round(5 / DT)) hash = s.x * 1e3 + s.y + s.arms[3][20];
      if (i % 240 === 0) {
        if (onProgress) onProgress(i / n);
        await yieldUI();
      }
    }
    if (fb) await fb.done();
    const r = an.finish();
    const cruise = cache.get("cruise") || (id === "cruise" ? r : null);
    const checks = judge(sc, r, cruise);
    const result = {
      id,
      title: sc.title,
      about: sc.about,
      seed: sc.seed,
      secs: sc.secs,
      status: statusOf(checks),
      checks,
      ...r,
      frames: fm.frames,
      hash5s: hash,
      flip: fb
        ? { every: fb.every, frames: fb.meta, perAtlas: PER, cols: COLS, tile: TILE, label: TLAB }
        : null,
    };
    if (film) {
      const ref = cache.get("cruise")?.frames;
      result.sheet = sheet(sc, fm.frames, id === "cruise" ? null : ref);
      result.onion = onionSkin(sc, fm.onion);
      result.traces = traces(sc, result, fm.window);
      result.traceWindows = { stroke: result.traces.stroke, turn: result.traces.turn };
    }
    if (keep) cache.set(id, result);
    return result;
  }
  // checks over the whole suite
  function suite(results) {
    const rests = results.flatMap((r) => r.rests);
    const out = [];
    const cv = rests.length > 1 ? sd(rests) / mean(rests) : NaN;
    const bins = new Map();
    for (const x of rests) {
      const b = Math.floor(x / T.restBin);
      bins.set(b, (bins.get(b) || 0) + 1);
    }
    const share = rests.length ? Math.max(...bins.values()) / rests.length : NaN;
    const enough = rests.length >= T.restMinN;
    out.push(
      check(
        "restCV",
        "rest durations vary",
        !rests.length ? "n/a" : !enough ? "warn" : cv >= T.restCV ? "pass" : "fail",
        cv,
        `CV >= ${T.restCV}`,
        `${rests.length} complete rests, ${r3(Math.min(...rests))}-${r3(Math.max(...rests))} s, mean ${r3(mean(rests))} s${enough ? "" : ` (fewer than ${T.restMinN})`}`,
      ),
    );
    out.push(
      check(
        "restMode",
        "no single dominant rest length",
        !rests.length ? "n/a" : !enough ? "warn" : share <= T.restModeShare ? "pass" : "fail",
        share,
        `<= ${T.restModeShare * 100}% in one ${T.restBin}s bin`,
      ),
    );
    const longest = results.filter((r) => r.metrics.restLongest != null);
    const lr = longest.length
      ? longest.reduce((a, b) => (b.metrics.restLongest > a.metrics.restLongest ? b : a))
      : null;
    out.push(
      check(
        "restMax",
        "no rest longer than 3 s",
        lr ? leq(lr.metrics.restLongest, T.restMax) : "n/a",
        lr ? lr.metrics.restLongest : null,
        `<= ${T.restMax} s`,
        lr ? `in ${lr.id}; the first rest of each run (set by place()) doesn't count` : "",
      ),
    );
    const cr = results.find((r) => r.id === "cruise");
    if (cr)
      out.push(
        check(
          "cruiseStill",
          "cruise is rarely still",
          leq(cr.metrics.stillFrac, T.stillFrac),
          cr.metrics.stillFrac,
          `<= ${T.stillFrac * 100}% of the time below ${T.stillSpeed} ML/s`,
          `longest still stretch ${cr.metrics.stillRunMax} s`,
        ),
      );
    return { rests, checks: out, status: statusOf(out) };
  }

  // the same scenario twice gives the same animal
  async function determinism() {
    const a = cache.get("cruise");
    if (!a) return null;
    const ses = session(SCENARIOS[0]);
    for (let i = 0; i <= Math.round(5 / DT); i++) ses.advance();
    const s = ses.snap;
    return s.x * 1e3 + s.y + s.arms[3][20] === a.hash5s;
  }

  async function runAll({ onProgress, film = true, only, flip } = {}) {
    cache.clear();
    const list = SCENARIOS.filter((s) => !only || only.includes(s.id) || s.id === "cruise");
    const results = [];
    for (const [n, sc] of list.entries()) {
      results.push(
        await run(sc.id, {
          film,
          flip: flip ? flip(sc.id) : null,
          onProgress: (p) => onProgress && onProgress(sc.id, (n + p) / list.length),
        }),
      );
      if (onProgress) onProgress(sc.id, (n + 1) / list.length, results.at(-1));
    }
    const s = suite(results);
    const det = await determinism();
    s.checks.push(
      check(
        "determinism",
        "a replay repeats exactly",
        det ? "pass" : "fail",
        det,
        "same state at 5 s",
      ),
    );
    s.status = statusOf(s.checks);
    return { results, suite: s };
  }

  // plain-data report (no canvases)
  function report({ results, suite: s }, extra = {}) {
    return {
      ...extra,
      dt: DT,
      viewport: { W: stage.W, H: stage.H, ML: results[0]?.ML, REACH: results[0]?.REACH },
      tune: stage.tune,
      palette: stage.palette,
      radii: { near: r3(stage.near), click: r3(stage.click) },
      thresholds: THRESHOLDS,
      suite: s,
      scenarios: results.map(
        ({ frames: _f, sheet: _s, raw: _r, onion: _o, traces: _t, flip: _p, ...r }) => r,
      ),
    };
  }

  window.LAB = {
    DT,
    THRESHOLDS,
    TUNE,
    PALETTE,
    SCENARIOS,
    attach,
    get stage() {
      return stage;
    },
    FLAGS,
    MOTION,
    flagCodes,
    flipEvery,
    session,
    run,
    grab,
    runAll,
    suite,
    report,
    cache,
    tipSpreadOf,
    armAxis,
  };
}
