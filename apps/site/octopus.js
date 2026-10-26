// The octopus that swims behind the landing page. Loaded as a classic script before the page's
// own script; exposes `window.sea` with start() and recolor(). Reads the page's data-theme and
// data-palette attributes for colours and honours prefers-reduced-motion.
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
    const CELL = 10;
    const SS = 2; // supersampling per cell
    const shade = document.createElement("canvas");
    const pat = document.createElement("canvas");
    const inkC = document.createElement("canvas");
    const sx = shade.getContext("2d", { willReadFrequently: true });
    const px = pat.getContext("2d", { willReadFrequently: true });
    const ix = inkC.getContext("2d", { willReadFrequently: true });
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
    };
    function recolor() {
      C = PALETTES[root.dataset.palette || "ember"][root.dataset.theme || "dark"];
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
      cv.width = W * dpr;
      cv.height = H * dpr;
      cols = Math.ceil(W / CELL);
      rows = Math.ceil(H / CELL);
      for (const [c, x] of [
        [shade, sx],
        [pat, px],
        [inkC, ix],
      ]) {
        c.width = cols * SS;
        c.height = rows * SS;
        x.setTransform(SS / CELL, 0, 0, SS / CELL, 0, 0);
      }
      S = W < 700 ? 0.85 : W < 1100 ? 1.05 : 1.2;
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
    const rnd = (a, b) => a + Math.random() * (b - a);
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
      brace: 0, // seconds of turning and inhaling before an escape jet
      flee: 0, // escape heading while bracing
      rest: 3,
      wx: 0,
      wy: 0,
      wpAge: 0,
      wander: 0,
      cool: 0,
      blanch: 0,
      inkLeft: 0,
      flowY: 0,
      inkT: 0,
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
          pose.wave * (0.25 + u) * Math.sin(t * 1.7 + a.ph[1] - u * 5);
        ang += k / N;
        x += Math.cos(ang) * seg;
        y += Math.sin(ang) * seg;
        T[j * 2] = x;
        T[j * 2 + 1] = y;
      }
    }

    // Arms are verlet chains: water drag (far stronger across an arm than along it), a muscle
    // pull toward the pose that is strong at the root and weak at the tip, and fixed segment
    // lengths solved root-outward. Tips lag, trail and drag through the water on their own.
    function stepArms(h, t) {
      for (const a of ARMS) {
        armTarget(a, t);
        const { p, q, t: T } = a;
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
          const K = 520 * (1 - u) * (1 - u) + 11;
          q[o] = p[o];
          q[o + 1] = p[o + 1];
          p[o] += vx + (T[o] - p[o]) * K * h * h;
          p[o + 1] += vy + (T[o + 1] - p[o + 1]) * K * h * h;
        }
        // fixed lengths, and no joint bends sharper than a real arm can
        let pa = Math.atan2(p[3] - p[1], p[2] - p[0]);
        for (let j = 1; j <= N; j++) {
          const o = j * 2;
          let ang = Math.atan2(p[o + 1] - p[o - 1], p[o] - p[o - 2]);
          if (j > 1) ang = pa + clamp(wrapA(ang - pa), -0.42, 0.42);
          p[o] = p[o - 2] + Math.cos(ang) * seg;
          p[o + 1] = p[o - 1] + Math.sin(ang) * seg;
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
          Math.random() * 0.6;
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
      O.wander = clamp(O.wander + (Math.random() - 0.5) * dt * 1.6, -0.5, 0.5);
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
    const inks = [];
    const snow = Array.from({ length: 46 }, () => ({
      x: Math.random() * 2000,
      y: Math.random() * 1400,
      vx: 0,
      vy: 0,
      v: rnd(2, 7),
      ch: Math.random() < 0.7 ? "." : "·",
    }));

    function siphon() {
      // the funnel opens just behind the mantle on the near side, pointing back
      const [f0, f1, n0, n1] = frame0();
      return [O.x - f0 * ML * 0.1 + n0 * MW * 0.42, O.y - f1 * ML * 0.1 + n1 * MW * 0.42];
    }

    function update(dt, t) {
      O.cool -= dt;
      O.wpAge += dt;
      if (Math.hypot(O.wx - O.x, O.wy - O.y) < 80 * S || O.wpAge > 16) pickWaypoint();
      let want = desiredHeading(dt);
      let turnRate;

      // Stroke cycle: a quick jet (the mantle squeezes, the arms snap shut and stream behind),
      // then a slow refill as the mantle swells and the arms flare open like an umbrella.
      let spreadT,
        curlT,
        relaxT,
        waveT,
        squeezeT = 0;
      power = 0;
      if (O.brace > 0) {
        // startled: inhale, flare and turn to face away before the first jet
        O.brace -= dt;
        want = O.flee;
        turnRate = 2.4;
        spreadT = 0.85;
        curlT = 0.4;
        relaxT = 0;
        waveT = 0.15;
        squeezeT = -0.7;
      } else if (O.mode === "swim") {
        O.phase += dt / O.period;
        if (O.phase >= 1) {
          O.phase -= 1;
          if (--O.strokes <= 0) {
            O.mode = "drift";
            O.rest = rnd(3, 7);
            O.thrust = 1;
            O.period = 1.6;
            O.inkLeft = 0;
          }
        }
        const p = O.phase;
        const flare = O.thrust > 1 ? 0.45 : 0.62;
        if (p < 0.28) {
          const u = p / 0.28;
          power = Math.sin(u * Math.PI);
          spreadT = flare + (0.16 - flare) * ease(Math.min(1, u * 1.4));
          curlT = 0.15;
          squeezeT = Math.sin(u * Math.PI * 0.5) * 1.0;
        } else {
          const u = (p - 0.28) / 0.72;
          spreadT = 0.16 + (flare - 0.16) * ease(Math.min(1, u * 1.15));
          curlT = 0.25 + 0.55 * u;
          squeezeT = Math.cos(u * Math.PI * 0.5) * 1.0 - 0.45 * Math.sin(u * Math.PI);
        }
        relaxT = 0;
        waveT = 0.35;
        turnRate = (p < 0.28 ? 0.45 : 0.95) * (O.thrust > 1 ? 1.8 : 1);
      } else {
        // drifting: slow breathing, the web half open, every arm tip doing its own thing
        O.rest -= dt;
        const open = 0.5 + 0.5 * Math.sin(t * 0.13 + 1);
        spreadT = 0.55 + 0.35 * open;
        curlT = 1;
        relaxT = 1;
        waveT = 0.55;
        squeezeT = 0.12 * Math.sin(t * 2.4);
        turnRate = 0.42;
        // hanging in the water the mantle floats up; it only lines up with where it is going
        // in the moment before it sets off
        if (O.rest > 1.5) {
          const up = -Math.PI / 2;
          want = up + clamp(wrapA(O.th - up), -0.7, 0.7) * 0.9;
        }
        if (O.rest < 0 && (Math.abs(wrapA(want - O.th)) < 0.45 || O.rest < -5)) {
          O.mode = "swim";
          O.phase = 0;
          O.strokes = Math.round(rnd(2, 4));
          O.period = rnd(1.4, 1.8);
        }
      }
      pose.spread = approach(pose.spread, spreadT, O.mode === "swim" ? 14 : 2.5, dt);
      pose.curl = approach(pose.curl, curlT, 3, dt);
      pose.relax = approach(pose.relax, relaxT, O.mode === "swim" ? 4 : 0.8, dt);
      pose.wave = approach(pose.wave, waveT, 2, dt);
      pose.squeeze = approach(pose.squeeze, squeezeT, 16, dt);
      // the soft mantle sags and sways behind the head when not driven
      pose.tilt = approach(pose.tilt, pose.relax * 0.16 * Math.sin(t * 0.5) - O.w * 0.12, 2, dt);

      // turning, smoothed so the heading never snaps
      const diff = wrapA(want - O.th);
      O.w = approach(O.w, clamp(diff * 2, -turnRate, turnRate), O.brace > 0 ? 8 : 2.6, dt);
      O.th += O.w * dt;

      // the jet pushes the mantle forward; the water slows everything down
      const f0 = Math.cos(O.th),
        f1 = Math.sin(O.th);
      const acc = power * 340 * S * O.thrust * (O.thrust > 1 ? 1.6 : 1);
      O.vx += f0 * acc * dt;
      O.vy += f1 * acc * dt;
      // a streamlined body: it slips forward easily, sideways hardly at all, and a flared web
      // brakes it
      const sp = Math.hypot(O.vx, O.vy);
      const vf = O.vx * f0 + O.vy * f1;
      const vl = -O.vx * f1 + O.vy * f0;
      const dF = 1.25 + (sp * 0.004) / S + (O.brace > 0 ? 6 : 0),
        dL = 4 + (O.brace > 0 ? 6 : 0);
      const nf = vf * Math.max(0, 1 - dF * dt),
        nl = vl * Math.max(0, 1 - dL * dt);
      O.vx = f0 * nf - f1 * nl;
      O.vy = f1 * nf + f0 * nl;
      if (O.mode === "drift") O.vy += (5 * S - O.vy) * 0.3 * dt; // slowly sinks
      O.x += O.vx * dt;
      O.y += O.vy * dt;
      O.blanch = Math.max(0, O.blanch - dt * 0.7);

      // scrolling moves the water (and everything in it) a little, eased in over a few frames
      const fy = O.flowY * Math.min(1, dt * 7);
      O.flowY -= fy;
      if (fy) {
        O.y += fy;
        O.wy += fy;
        for (const a of ARMS)
          for (let j = 1; j < a.p.length; j += 2) {
            a.p[j] += fy;
            a.q[j] += fy;
          }
        for (const k of inks) k.y += fy;
        for (const b of wake) b.y += fy;
      }

      const steps = Math.max(1, Math.ceil(dt / (1 / 100)));
      for (let i = 0; i < steps; i++) stepArms(dt / steps, t - dt + ((i + 1) * dt) / steps);

      // jet water: faint specks and stirred marine snow behind the funnel, ink if alarmed
      const [jx, jy] = siphon();
      if (power > 0.3 && Math.random() < dt * 26 * O.thrust)
        wake.push({
          x: jx,
          y: jy,
          vx: -f0 * rnd(60, 130) * O.thrust + rnd(-15, 15),
          vy: -f1 * rnd(60, 130) * O.thrust + rnd(-15, 15),
          life: rnd(0.5, 0.9),
        });
      // ink leaves the funnel with the first jet: a dense blob, then a thinning streak
      if (O.inkLeft > 0 && power > 0.1) {
        O.inkT -= dt;
        if (O.inkT <= 0) {
          O.inkT = 0.025;
          const k = O.inkLeft / 14;
          O.inkLeft--;
          inks.push({
            x: jx,
            y: jy,
            r: (3 + 6 * k) * S,
            vr: (10 + 26 * k) * S * rnd(0.7, 1.2),
            vx: -f0 * rnd(50, 170) + rnd(-55, 55),
            vy: -f1 * rnd(50, 170) + rnd(-55, 55),
            life: 0.6 + 0.4 * k,
          });
        }
      }
      for (const b of wake) {
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.vx *= 1 - dt * 3;
        b.vy *= 1 - dt * 3;
        b.life -= dt;
      }
      for (let i = wake.length - 1; i >= 0; i--) if (wake[i].life <= 0) wake.splice(i, 1);
      for (const k of inks) {
        k.r += k.vr * dt;
        k.vr *= 1 - dt * 0.55;
        k.x += k.vx * dt;
        k.y += k.vy * dt + 3 * dt;
        k.vx *= 1 - dt * 2.4;
        k.vy *= 1 - dt * 2.4;
        k.life -= dt / 8;
      }
      for (let i = inks.length - 1; i >= 0; i--) if (inks[i].life <= 0) inks.splice(i, 1);
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

    // Startle: turn away, inhale, then a burst of hard jets; with `ink`, a cloud first.
    function startle(x, y, ink) {
      if (!running || O.cool > 0) return;
      const away = Math.atan2(O.y - y, O.x - x);
      let best = -1e9;
      for (let k = -4; k <= 4; k++) {
        const a = away + k * 0.32;
        const tx = O.x + Math.cos(a) * 380 * S,
          ty = O.y + Math.sin(a) * 380 * S;
        const sc = appeal(tx, ty) - Math.abs(k) * 0.3 - Math.abs(wrapA(a - O.th)) * 0.8;
        if (sc > best) {
          best = sc;
          O.flee = a;
          O.wx = clamp(tx, 60, W - 60);
          O.wy = clamp(ty, 60, H - 60);
        }
      }
      O.wpAge = 0;
      O.mode = "swim";
      O.brace = 0.12 + Math.abs(wrapA(O.flee - O.th)) * 0.2;
      O.phase = 0;
      O.strokes = ink ? 4 : 3;
      O.period = 0.85;
      O.thrust = 2.2;
      O.blanch = ink ? 1 : 0.7;
      O.inkLeft = ink ? 14 : 0;
      O.cool = 2.5;
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
      ix.clearRect(0, 0, W, H);

      for (const k of inks) {
        const gr = ix.createRadialGradient(k.x, k.y, 0, k.x, k.y, k.r);
        gr.addColorStop(0, `rgba(255,255,255,${Math.min(1, k.life * 1.3) * 0.85})`);
        gr.addColorStop(0.6, `rgba(255,255,255,${Math.min(1, k.life * 1.3) * 0.45})`);
        gr.addColorStop(1, "rgba(255,255,255,0)");
        ix.fillStyle = gr;
        ix.beginPath();
        ix.arc(k.x, k.y, k.r, 0, 7);
        ix.fill();
      }

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
      // alarmed octopuses blanch
      if (O.blanch > 0) {
        px.save();
        px.beginPath();
        px.ellipse(mx, my, mlen, mwid, mt, 0, 7);
        px.ellipse(hx, hy, ML * 0.28, MW * 0.33, O.th, 0, 7);
        px.clip();
        px.beginPath();
        const st = 12 * S,
          r = st * 0.26 * Math.min(1, O.blanch * 1.4);
        for (let a = -1.3; a <= 1.3; a += st / mlen / 1.1)
          for (let b = -1.2; b <= 1.2; b += st / mwid / 1.1) {
            const qx = mx + m0 * a * mlen - m1 * b * mwid,
              qy = my + m1 * a * mlen + m0 * b * mwid;
            px.moveTo(qx + r, qy);
            px.arc(qx, qy, r, 0, 7);
          }
        px.fill();
        px.restore();
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

      // only the cells around the animal (and its ink) are sampled
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
      for (const k of inks) grow(k.x, k.y, k.r);
      return {
        c0: Math.max(0, Math.floor(x0 / CELL)),
        r0: Math.max(0, Math.floor(y0 / CELL)),
        c1: Math.min(cols - 1, Math.ceil(x1 / CELL)),
        r1: Math.min(rows - 1, Math.ceil(y1 / CELL)),
      };
    }

    const CHARS = [".", ":", "+", "x", "%", "8"];

    function draw() {
      const box = render();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // marine snow
      ctx.font = `10px "Geist Mono", monospace`;
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
      const id = ix.getImageData(box.c0 * SS, box.r0 * SS, bw * SS, bh * SS).data;
      const rowW = bw * SS * 4;
      const buckets = {};
      const glyphs = [];
      const add = (col, x, y, a) => (buckets[col + "|" + a] ||= []).push(x, y);
      const eyeCells = new Set(
        eyes.map(([x, y]) => Math.floor(x / CELL) + "," + Math.floor(y / CELL)),
      );
      const k = SS * SS * 255;

      for (let r = 0; r < bh; r++) {
        for (let c = 0; c < bw; c++) {
          let L = 0,
            A = 0,
            P = 0,
            I = 0;
          for (let yy = 0; yy < SS; yy++)
            for (let xx = 0; xx < SS; xx++) {
              const o = (r * SS + yy) * rowW + (c * SS + xx) * 4;
              L += sd[o] * sd[o + 3];
              A += sd[o + 3];
              P += pd[o + 3];
              I += id[o + 3];
            }
          const lum = L / k / 255; // shade × coverage
          A /= k;
          P /= k;
          I /= k;
          const gx = (box.c0 + c) * CELL,
            gy = (box.r0 + r) * CELL;
          if (eyeCells.has(box.c0 + c + "," + (box.r0 + r))) {
            add(C.ink, gx, gy, 1);
            glyphs.push(gx, gy, "o", C.hi);
            continue;
          }
          if (lum < 0.08) {
            if (I > 0.1)
              add(C.ink, gx, gy, (Math.round(Math.min(0.85, I * 1.2) * 20) / 20).toFixed(2));
            continue;
          }
          let col;
          if (A < 0.35 || lum < 0.2) col = C.fringe;
          else if (P > 0.45) col = lum > 0.62 ? C.hi : C.pale;
          else if (lum > 0.8) col = C.lt;
          else if (lum > 0.52) col = C.mid;
          else if (lum > 0.3) col = C.deep;
          else col = C.grey;
          add(col, gx, gy, 1);
          if (col !== C.fringe)
            glyphs.push(gx, gy, CHARS[Math.min(5, Math.floor(lum * 6))], C.glyph);
        }
      }

      const sz = CELL - 1.5;
      for (const key in buckets) {
        const [col, a] = key.split("|");
        ctx.globalAlpha = +a;
        ctx.fillStyle = col;
        ctx.beginPath();
        const b = buckets[key];
        for (let i = 0; i < b.length; i += 2)
          ctx.roundRect(b[i] + 0.75, b[i + 1] + 0.75, sz, sz, 1.6);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.font = `500 7.5px "Geist Mono", monospace`;
      for (let i = 0; i < glyphs.length; i += 4) {
        ctx.fillStyle = glyphs[i + 3];
        ctx.fillText(glyphs[i + 2], glyphs[i] + CELL / 2, glyphs[i + 1] + CELL / 2 + 0.5);
      }
    }

    let prev = 0,
      now = 0;
    function frame(ms) {
      const dt = Math.min(0.05, (ms - prev) / 1000 || 0.016);
      prev = ms;
      now = ms / 1000;
      update(dt, now);
      draw();
      requestAnimationFrame(frame);
    }

    // Scrolling moves the water past the animal, so it drifts with the page a little. The
    // shift is eased in by update() and never pushes it far off screen.
    let lastScroll = scrollY;
    addEventListener(
      "scroll",
      () => {
        const d = scrollY - lastScroll;
        lastScroll = scrollY;
        const to = clamp(O.y + O.flowY - d * 0.2, -60, H + 60);
        O.flowY = to - O.y;
      },
      { passive: true },
    );

    addEventListener("pointermove", (e) => {
      const dx = e.clientX - O.x,
        dy = e.clientY - O.y;
      if (Math.hypot(dx, dy) < 95 * S + Math.max(0, Math.cos(Math.atan2(dy, dx) - O.th)) * ML)
        startle(e.clientX, e.clientY, false);
    });
    addEventListener("pointerdown", (e) => {
      if (e.target.closest("a,button,.card")) return;
      if (Math.hypot(e.clientX - O.x, e.clientY - O.y) < 260 * S) {
        O.cool = 0;
        startle(e.clientX, e.clientY, true);
      }
    });

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
          settle(ms / 1000 - 2, 2);
          requestAnimationFrame(frame);
        });
      }
    }
    return { start, recolor };
  })();
}
