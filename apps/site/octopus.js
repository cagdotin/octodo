// The octopus that swims behind the landing page. Loaded as a classic script before the page's
// own script; exposes `window.sea` with start(), recolor() and set() (the tuning panel's knobs, see
// DEFAULTS). Reads the page's data-theme and data-palette attributes for colours and honours
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
    // Knobs the page's tuning panel turns. density: cells per 10px (v5 was 1); glyphs: none |
    // subtle | ascii; size: body scale; speed: cruising thrust; react: how far off the pointer
    // frightens it; scroll: how far scrolling turns it.
    const DEFAULTS = { density: 1.2, glyphs: "subtle", size: 1, speed: 1, react: 1, scroll: 1 };
    const tune = { ...DEFAULTS };
    let CELL = 10; // tile size in px, set by resize() from tune.density
    const SS = 2; // supersampling per cell
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
    function recolor() {
      C = (PALETTES[root.dataset.palette] || PALETTES.ember)[root.dataset.theme || "dark"];
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
      S = (W < 700 ? 0.85 : W < 1100 ? 1.05 : 1.2) * tune.size;
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
      fear: 0, // 0..1, builds while the pointer stays close or follows, scales the escape
      fleeA: 0, // smoothed escape heading
      fleeMin: 0, // a fright lasts at least this long
      grip: 0, // 0..1, eases in while fleeing: how firmly the arms are held to their reach
      rest: 3,
      wx: 0,
      wy: 0,
      wpAge: 0,
      wander: 0,
      pc: 0.28, // the part of the stroke cycle that is the jet and the close
      shut: 0, // 1 through the close and glide, falling to 0 as the arms open again
      loose: 0, // like shut, but rising only once the arms are well on their way in
      sv: 0, // scroll speed, px/s, low-passed
      sk: 0, // 0..1, how much scrolling is going on, eased
      ws: 0, // the turn scrolling is giving it, rad/s
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
      };
    });
    // slow, smooth, per-arm noise in [-1, 1]
    const nz = (a, t, k) =>
      0.62 * Math.sin(t * a.w[k] + a.ph[k]) + 0.38 * Math.sin(t * a.w[k] * 2.31 + a.ph[k] * 1.7);

    const frame0 = () => {
      const f0 = Math.cos(O.th),
        f1 = Math.sin(O.th);
      return [f0, f1, -f1, f0];
    };

    // The pose an arm's muscles hold, in world space: rooted on the crown behind the head,
    // fanned by `spread`, with a tip curl and a slow wave travelling out along it.
    function armTarget(a, t) {
      const [f0, f1, n0, n1] = frame0();
      const s = a.s,
        sg = Math.sign(s);
      const ra = -0.36 * ML + Math.abs(s) * 0.06 * ML,
        rb = s * MW * 0.36;
      let x = O.x + f0 * ra + n0 * rb,
        y = O.y + f1 * ra + n1 * rb;
      const T = a.t;
      T[0] = x;
      T[1] = y;
      const spread = clamp(pose.spread + pose.relax * 0.1 * nz(a, t, 0), 0, 1.1);
      // positive s sits on the +n side; rotating by -s fans it out to that side
      let ang = O.th + Math.PI - s * (0.08 + 0.75 * spread) + pose.relax * 0.16 * nz(a, t, 1);
      // tip curl: inward (toward the axis, a bell) when swimming, wandering when relaxed
      const c =
        pose.curl * (sg * 0.6 * (1 - pose.relax) + pose.relax * (0.45 * sg + 0.65 * nz(a, t, 2)));
      const seg = (a.len * AL) / N;
      for (let j = 1; j <= N; j++) {
        const u = (j - 0.5) / N;
        const k =
          -s * spread * 0.5 +
          sg * pose.relax * 0.55 * spread +
          c * 8 * u * u * u +
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
      const w = O.shut;
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
      const m0 = mz - (u > 0.76 ? (0.3 * ML * (u - 0.76)) / 0.24 : 0);
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
      LET_GO = 0.3,
      RIPPLE = 2.2,
      WHIP = 10;
    function stepArms(h, t) {
      const fast = Math.max(1, Math.hypot(O.vx, O.vy) / (80 * S)) ** 2;
      const hold = Math.max(
        // (only once the reach has closed in: the first stroke of a fright stays held)
        Math.min(1, h * 20 * (fast - 1)) * (1 - LET_GO * O.loose * O.grip ** 4),
        Math.min(1, h * 20 * O.sk),
      );
      const [f0, f1, n0, n1] = frame0();
      const reach = ML * (REACH + 4 * (1 - O.grip)),
        soft = reach * 0.1,
        mw = O.shut,
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
          if (j > 1) ang = pa + clamp(wrapA(ang - pa), -0.42, 0.42);
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
          if (mw > 0) {
            // an arm that starts out across (curled there while drifting) eases back over, never
            // flicked across in a frame: each node moves its own segment at most 1.2 mantle
            // lengths a second
            const l = lp + dl,
              to = l + clamp(midline(a, j, l, mw) - l, -1.2 * ML * h, 1.2 * ML * h);
            if (to !== l) {
              const db = dx * f0 + dy * f1;
              dl = clamp(to - lp, -seg, seg);
              const b = back(db, o) * Math.sqrt(Math.max(0, seg * seg - dl * dl));
              dx = f0 * b + n0 * dl;
              dy = f1 * b + n1 * dl;
              ang = Math.atan2(dy, dx);
            }
          }
          p[o] = p[o - 2] + dx;
          p[o + 1] = p[o - 1] + dy;
          pa = ang;
        }
      }
    }

    // --- where to go ----------------------------------------------------------------------
    // A spot's appeal: on screen, clear of the text column, not too near or far, and roughly
    // ahead, so it rarely has to turn right round.
    function appeal(x, y) {
      const m = 90 * S;
      let v = 0;
      v -= Math.max(0, m - x, x - (W - m)) / 40;
      v -= Math.max(0, m - y, y - (H - m)) / 40;
      if (band && x > colL - 60 && x < colR + 60) v -= 2.2;
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
          Math.abs(d - 320 * S) / (260 * S) +
          ahead * 0.6 -
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

    function desiredHeading(dt) {
      let dx = O.wx - O.x,
        dy = O.wy - O.y;
      const d = Math.hypot(dx, dy) || 1;
      dx /= d;
      dy /= d;
      O.wander = clamp(O.wander + (random() - 0.5) * dt * 1.6, -0.5, 0.5);
      const c = Math.cos(O.wander * 0.6),
        s = Math.sin(O.wander * 0.6);
      [dx, dy] = [dx * c - dy * s, dx * s + dy * c];
      // edges and the text column push softly
      const m = 70 * S;
      dx += (Math.max(0, m - O.x) - Math.max(0, O.x - (W - m))) / m;
      dy += (Math.max(0, m - O.y) - Math.max(0, O.y - (H - m))) / m;
      if (band && O.x > colL - 60 && O.x < colR + 60)
        dx += 0.8 * clamp((O.x - (colL - 60)) / 120, 0, 1);
      return Math.atan2(dy, dx);
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

    function update(dt, t) {
      const x0 = O.x,
        y0 = O.y,
        th0 = O.th;
      O.wpAge += dt;
      pressure(dt);
      scrolled(dt);
      O.grip = approach(O.grip, Math.max(O.hurry ? 1 : 0, O.sk), 6, dt);
      if (!O.hurry && (Math.hypot(O.wx - O.x, O.wy - O.y) < 80 * S || O.wpAge > 16)) pickWaypoint();
      const toWaypoint = O.hurry ? 0 : desiredHeading(dt);
      let want = O.hurry ? O.fleeA : toWaypoint;
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
          // a hurrying octopus keeps stroking until it gets there
          if (!O.hurry && --O.strokes <= 0) {
            O.mode = "drift";
            O.rest = rnd(3, 7) / Math.max(0.3, tune.speed);
            O.thrust = 1;
            O.period = 1.6;
          }
        }
        const p = O.phase;
        const flare = 0.62;
        // A faster stroke never shortens the jet and close (0.29s, as at the first fright): the
        // time comes out of the opening. The jet's push is scaled to give the same impulse.
        const pc = (O.pc = O.hurry ? Math.min(0.45, 0.294 / O.period) : 0.28);
        const shutT = O.hurry ? 0 : 0.16;
        if (p < pc) {
          const u = p / pc;
          power = Math.sin(u * Math.PI) * (0.28 / pc);
          O.shut = ease(Math.min(1, u * 2.5));
          // the arms stay held until they are well on their way in, off the reach, so none
          // springs loose from where the reach held it bent
          O.loose = ease(clamp((u - 0.35) / 0.45, 0, 1));
          spreadT = flare + (shutT - flare) * ease(Math.min(1, u * 1.4));
          curlT = 0.15;
          squeezeT = Math.sin(u * Math.PI * 0.5) * 1.0;
        } else {
          // fleeing, it glides shut for a moment, then opens a little quicker, as wide as ever
          const g = O.hurry ? 0.38 : 0,
            u = Math.max(0, (p - pc) / (1 - pc) - g) / (1 - g);
          const open = ease(Math.min(1, u * (O.hurry ? 1.5 : 1.15)));
          O.shut = O.loose = 1 - open;
          spreadT = shutT + (flare - shutT) * open;
          curlT = 0.25 + 0.55 * u;
          squeezeT = Math.cos(u * Math.PI * 0.5) * 1.0 - 0.45 * Math.sin(u * Math.PI);
        }
        relaxT = 0;
        waveT = 0.35;
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
        if (
          O.rest < 0 &&
          (Math.abs(wrapA(want - O.th)) < (O.hurry ? (room(O.th) > 150 * S ? 1.6 : 0.5) : 0.45) ||
            O.rest < -5)
        ) {
          O.mode = "swim";
          O.phase = 0;
          O.strokes = Math.round(rnd(2, 4));
          if (!O.hurry) {
            O.period = rnd(1.4, 1.8);
            O.thrust = 1;
          }
        }
      }
      pose.spread = approach(pose.spread, spreadT, O.mode === "swim" ? 14 : 2.5, dt);
      pose.curl = approach(pose.curl, curlT, 3, dt);
      pose.relax = approach(pose.relax, relaxT, O.mode === "swim" ? 4 : 0.8, dt);
      pose.wave = approach(pose.wave, waveT, 2, dt);
      pose.squeeze = approach(pose.squeeze, squeezeT, 16, dt);
      // the soft mantle sags and sways behind the head when not driven
      pose.tilt = approach(
        pose.tilt,
        pose.relax * 0.16 * Math.sin(t * 0.5) - (O.w + O.ws) * 0.12,
        2,
        dt,
      );

      // turning, smoothed so the heading never snaps; while scrolling turns it, it barely steers
      // against that, and afterwards it eases back the ordinary way
      turnRate *= 1 - 0.75 * O.sk;
      const diff = wrapA(want - O.th);
      O.w = approach(O.w, clamp(diff * 2, -turnRate, turnRate), 2.6, dt);
      O.th += (O.w + O.ws) * dt;

      // the jet pushes the mantle forward; the water slows everything down
      const f0 = Math.cos(O.th),
        f1 = Math.sin(O.th);
      const acc = power * 340 * S * O.thrust * (O.hurry ? 1 : tune.speed);
      O.vx += f0 * acc * dt;
      O.vy += f1 * acc * dt;
      // a streamlined body: it slips forward easily, sideways hardly at all
      const sp = Math.hypot(O.vx, O.vy);
      const vf = O.vx * f0 + O.vy * f1;
      const vl = -O.vx * f1 + O.vy * f0;
      // fleeing, it holds the streamlined glide longer, so each stroke carries it further
      const dF = (1.25 + (sp * 0.004) / S) * (O.hurry ? 1 - GLIDE * O.fear : 1),
        dL = 4;
      const nf = vf * Math.max(0, 1 - dF * dt),
        nl = vl * Math.max(0, 1 - dL * dt);
      O.vx = f0 * nf - f1 * nl;
      O.vy = f1 * nf + f0 * nl;
      if (O.mode === "drift") O.vy += (5 * S - O.vy) * 0.3 * dt; // slowly sinks
      // the screen edge is a soft wall: never more than part of the body slips past it
      const wm = 70 * S;
      O.vx += (Math.max(0, wm - O.x) - Math.max(0, O.x - (W - wm))) * 18 * dt;
      O.vy += (Math.max(0, wm - O.y) - Math.max(0, O.y - (H - wm))) * 18 * dt;
      O.x += O.vx * dt;
      O.y += O.vy * dt;

      // scrolling only drifts the marine snow a little; the animal itself just turns
      const fy = -O.sv * 0.06 * dt;

      // the arms step at 100Hz with the body moved smoothly between frames, so no arm point is
      // handed a whole frame's travel in one substep
      const steps = Math.max(1, Math.ceil(dt / (1 / 100)));
      const x1 = O.x,
        y1 = O.y,
        th1 = O.th;
      for (let i = 0; i < steps; i++) {
        const k = (i + 1) / steps;
        O.x = x0 + (x1 - x0) * k;
        O.y = y0 + (y1 - y0) * k;
        O.th = th0 + (th1 - th0) * k;
        stepArms(dt / steps, t - dt + k * dt);
      }

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
      GLIDE = 0.4;
    let ptr = null,
      lastD = Infinity,
      closing = 0;
    const NEAR = () => 230 * S * tune.react;

    // how far the animal can swim at angle a before reaching the screen margin
    function room(a) {
      const m = 80 * S,
        c = Math.cos(a),
        s = Math.sin(a);
      let r = 420 * S;
      if (c > 1e-3) r = Math.min(r, (W - m - O.x) / c);
      if (c < -1e-3) r = Math.min(r, (m - O.x) / c);
      if (s > 1e-3) r = Math.min(r, (H - m - O.y) / s);
      if (s < -1e-3) r = Math.min(r, (m - O.y) / s);
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
      // fear quickens the stroke and makes it push harder and glide further; it never opens
      // the arms wider (see REACH)
      O.period = 1.05 - 0.3 * O.fear;
      O.thrust = 1.7 + THRUST * O.fear;
      if (d > R * 1.15 && O.fear < 0.25 && O.fleeMin <= 0) {
        // safe: finish this stroke and settle down
        O.hurry = false;
        O.strokes = 1;
        pickWaypoint();
      }
    }

    function startFlee(min) {
      if (!running) return;
      O.fleeMin = Math.max(O.fleeMin, min);
      if (O.hurry) return;
      O.hurry = true;
      O.fleeA = ptr ? Math.atan2(O.y - ptr.y, O.x - ptr.x) : O.th;
      if (O.mode === "drift") O.rest = 0;
    }

    // --- drawing ----------------------------------------------------------------------------
    const g = (v) => `rgb(${v * 255},${v * 255},${v * 255})`;
    const LIGHT = [-0.45, -0.89];
    const armWidth = (u) => MW * 0.1 * Math.pow(1 - u, 0.9) + 1.5 * S;

    function drawArm(a, lvl, highlight) {
      const p = a.p;
      sx.lineCap = "round";
      sx.strokeStyle = g(lvl);
      for (let j = 0; j < N; j++) {
        sx.lineWidth = armWidth(j / N);
        sx.beginPath();
        sx.moveTo(p[j * 2], p[j * 2 + 1]);
        sx.lineTo(p[j * 2 + 2], p[j * 2 + 3]);
        sx.stroke();
      }
      sx.strokeStyle = g(highlight);
      px.fillStyle = "#fff";
      for (let j = 0; j < N - 1; j++) {
        const wd = armWidth(j / N);
        const ox = LIGHT[0] * wd * 0.22,
          oy = LIGHT[1] * wd * 0.22;
        sx.lineWidth = wd * 0.42;
        sx.beginPath();
        sx.moveTo(p[j * 2] + ox, p[j * 2 + 1] + oy);
        sx.lineTo(p[j * 2 + 2] + ox, p[j * 2 + 3] + oy);
        sx.stroke();
        // pale suckers down the inside of the curl
        if (j >= 3 && j % 3 === 0 && j < N - 2) {
          const dx = p[j * 2 + 2] - p[j * 2],
            dy = p[j * 2 + 3] - p[j * 2 + 1];
          const l = Math.hypot(dx, dy) || 1;
          const ex = p[j * 2 + 4] - p[j * 2 + 2],
            ey = p[j * 2 + 5] - p[j * 2 + 3];
          const side = dx * ey - dy * ex >= 0 ? 1 : -1;
          px.beginPath();
          px.arc(
            p[j * 2] + (-dy / l) * side * wd * 0.3,
            p[j * 2 + 1] + (dx / l) * side * wd * 0.3,
            wd * 0.24,
            0,
            7,
          );
          px.fill();
        }
      }
    }

    function shadedEllipse(cx, cy, rx, ry, rot, hi, lo) {
      const gr = sx.createRadialGradient(
        cx + LIGHT[0] * rx * 0.35,
        cy + LIGHT[1] * ry * 0.45,
        0,
        cx,
        cy,
        Math.max(rx, ry) * 1.05,
      );
      gr.addColorStop(0, g(hi));
      gr.addColorStop(0.55, g(hi * 0.8));
      gr.addColorStop(1, g(lo));
      sx.fillStyle = gr;
      sx.beginPath();
      sx.ellipse(cx, cy, rx, ry, rot, 0, 7);
      sx.fill();
    }

    let eyes = [];
    function render() {
      const [f0, f1, n0, n1] = frame0();
      sx.clearRect(0, 0, W, H);
      px.clearRect(0, 0, W, H);

      // webbing between neighbouring arms, a sagging skin that shows when they open
      const wk = Math.max(1, Math.round(N * (0.04 + 0.12 * clamp(pose.spread, 0, 1))));
      sx.fillStyle = g(0.34);
      for (let i = 0; i < 7; i++) {
        const a = ARMS[i].p,
          b = ARMS[i + 1].p;
        sx.beginPath();
        sx.moveTo(a[0], a[1]);
        for (let j = 1; j <= wk; j++) sx.lineTo(a[j * 2], a[j * 2 + 1]);
        const mx = (a[wk * 2] + b[wk * 2]) / 2,
          my = (a[wk * 2 + 1] + b[wk * 2 + 1]) / 2;
        const cx = mx + (a[0] - mx) * 0.35,
          cy = my + (a[1] - my) * 0.35;
        sx.quadraticCurveTo(cx, cy, b[wk * 2], b[wk * 2 + 1]);
        for (let j = wk - 1; j >= 0; j--) sx.lineTo(b[j * 2], b[j * 2 + 1]);
        sx.fill();
      }

      for (const a of ARMS) if (a.far) drawArm(a, 0.5, 0.66);

      // head, then the mantle hanging off the neck, squeezed on each jet
      const hx = O.x - f0 * ML * 0.14,
        hy = O.y - f1 * ML * 0.14;
      shadedEllipse(hx, hy, ML * 0.28, MW * 0.33, O.th, 0.9, 0.45);
      for (const a of ARMS) if (!a.far) drawArm(a, 0.64, 0.86);
      const mt = O.th + pose.tilt;
      const sq = pose.squeeze;
      const mlen = ML * 0.62 * (1 + 0.07 * sq),
        mwid = MW * 0.56 * (1 - 0.2 * sq);
      const mx = O.x + Math.cos(mt) * mlen * 0.92,
        my = O.y + Math.sin(mt) * mlen * 0.92;
      shadedEllipse(mx, my, mlen, mwid, mt, 1, 0.42);

      // mottled pale patches on the mantle, fixed to the body
      const m0 = Math.cos(mt),
        m1 = Math.sin(mt);
      const spots = [
        [0.35, -0.32, 3.5],
        [-0.1, 0.42, 3.5],
        [0.55, 0.22, 2.8],
        [-0.35, -0.2, 3],
      ];
      px.fillStyle = "#fff";
      for (const [lx, ly, r] of spots) {
        px.beginPath();
        px.arc(
          mx + m0 * lx * mlen - m1 * ly * mwid,
          my + m1 * lx * mlen + m0 * ly * mwid,
          r * S,
          0,
          7,
        );
        px.fill();
      }

      eyes = [-1, 1].map((side) => [
        hx + n0 * side * MW * 0.32 - f0 * ML * 0.02,
        hy + n1 * side * MW * 0.32 - f1 * ML * 0.02,
      ]);
      for (const [ex, ey] of eyes) {
        sx.fillStyle = g(1);
        sx.beginPath();
        sx.arc(ex, ey, 5.5 * S, 0, 7);
        sx.fill();
        px.beginPath();
        px.arc(ex, ey, 5.5 * S, 0, 7);
        px.fill();
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
      grow(O.x, O.y, ML * 1.3);
      grow(mx, my, ML);
      for (const a of ARMS) for (let j = 0; j < a.p.length; j += 2) grow(a.p[j], a.p[j + 1], 12);
      return {
        c0: Math.max(0, Math.floor(x0 / CELL)),
        r0: Math.max(0, Math.floor(y0 / CELL)),
        c1: Math.min(cols - 1, Math.ceil(x1 / CELL)),
        r1: Math.min(rows - 1, Math.ceil(y1 / CELL)),
      };
    }

    const CHARS = [".", ":", "+", "x", "%", "8"];
    const RAMP = " .:-=+*#%@";

    function draw() {
      const box = render();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

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
      if (bw <= 0 || bh <= 0) return;
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
            add(C.ink, gx, gy, 1);
            if (!C.flat) glyphs.push(gx, gy, "o", C.hi);
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
      addEventListener("resize", () => {
        resize();
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
          } else if (["none", "subtle", "ascii"].includes(v)) tune[key] = v;
        }
      if (W && ("density" in opts || "size" in opts)) resize();
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
      pointer: (x, y) => (x == null ? gone() : (ptr = { x, y })),
      click: (x, y) => fright(x, y),
      // as if the page scrolled by dy px since the last frame
      scroll: (dy) => void (scrollAcc += dy),
      // start over: the animal at rest somewhere, facing somewhere, unafraid, its arms settled
      // on their pose, the clock at 0 (with seed() first, a run then repeats exactly)
      place(x, y, th = O.th) {
        Object.assign(O, { x, y, th, vx: 0, vy: 0, w: 0, mode: "drift", phase: 0, period: 1.6 });
        Object.assign(O, { strokes: 0, thrust: 1, hurry: false, fear: 0, fleeMin: 0, grip: 0 });
        Object.assign(O, { rest: 3, wander: 0, wpAge: 0, fleeA: th, pc: 0.28, shut: 0, loose: 0 });
        Object.assign(O, { sv: 0, sk: 0, ws: 0 });
        Object.assign(pose, { spread: 0.6, curl: 1, relax: 1, wave: 0.6, squeeze: 0, tilt: 0 });
        ptr = null;
        lastD = Infinity;
        closing = 0;
        scrollAcc = 0;
        wake.length = 0;
        now = 0;
        pickWaypoint();
        settle(-2, 2);
      },
      snapshot: () => ({
        t: now,
        x: O.x,
        y: O.y,
        vx: O.vx,
        vy: O.vy,
        th: O.th,
        w: O.w + O.ws,
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
      }),
    };

    return { start, recolor, set, defaults: { ...DEFAULTS }, lab };
  })();
}
