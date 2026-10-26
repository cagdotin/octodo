// The octopus lab's page: runs the suite (lab/engine.js) on load, lists the scenarios with their
// verdicts, and shows one at a time: checks, anomaly flags, metrics, charts, the filmstrip, onion
// skin and traces, a frame-by-frame flipbook of the tiled pixels, and a deterministic replay
// through sea.lab with play/pause/scrub. ?tune={...}&palette=... override the lab's settings.
{
  const q = new URLSearchParams(location.search);
  const $ = (id) => document.getElementById(id);
  const W = +(q.get("w") || 1440),
    H = +(q.get("h") || 900);
  const iframe = $("stage");
  iframe.width = W;
  iframe.height = H;
  iframe.src = "/lab/stage.html" + (q.get("src") ? "?src=" + encodeURIComponent(q.get("src")) : "");
  $("src").textContent = (q.get("src") || "/octopus.js") + ` · ${W}×${H}`;
  let tuneQ = {};
  try {
    tuneQ = JSON.parse(q.get("tune") || "{}") || {};
  } catch {
    tuneQ = {};
  }
  const TUNE = { ...LAB.TUNE, ...tuneQ };
  const PALETTE = q.get("palette") || LAB.PALETTE;

  if (!q.has("headless")) ui();

  function ui() {
    const { SCENARIOS, THRESHOLDS: T, DT } = LAB;
    let all = null; // { results, suite } of the last full run
    let selected = "suite";
    let busy = false;
    const css = (k) => getComputedStyle(document.documentElement).getPropertyValue(k).trim();
    const esc = (s) =>
      String(s).replace(
        /[&<>"]/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
      );
    const fmt = (v, d = 2) =>
      v == null
        ? "–"
        : typeof v === "number"
          ? Number.isFinite(v)
            ? v.toFixed(d)
            : String(v)
          : esc(v);
    const badge = (s) => `<span class="badge ${s || ""}">${s || "…"}</span>`;

    // --- settings: the animal's tuning for every run (reloads with ?tune=&palette=) -------------
    {
      const knobs = [
        ["density", 0.6, 2.4, 0.05],
        ["size", 0.6, 1.6, 0.05],
        ["speed", 0.4, 2.5, 0.05],
        ["react", 0, 2, 0.05],
        ["scroll", 0, 3, 0.1],
      ];
      $("tuneRow").innerHTML =
        knobs
          .map(
            ([k, lo, hi, st]) =>
              `<label>${k} <input type="number" data-k="${k}" min="${lo}" max="${hi}" step="${st}" value="${TUNE[k]}" /></label>`,
          )
          .join("") +
        `<label>glyphs <select data-k="glyphs">${["none", "subtle", "ascii"].map((g) => `<option${g === TUNE.glyphs ? " selected" : ""}>${g}</option>`).join("")}</select></label>` +
        `<label>palette <select id="palSel">${["ember", "ink", "paper", "onebit"].map((p) => `<option${p === PALETTE ? " selected" : ""}>${p}</option>`).join("")}</select></label>` +
        `<button id="tuneApply">apply and rerun</button><button id="tuneDefault">lab defaults</button>`;
      $("tuneApply").onclick = () => {
        const t = {};
        $("tuneRow")
          .querySelectorAll("[data-k]")
          .forEach((i) => (t[i.dataset.k] = i.tagName === "SELECT" ? i.value : +i.value));
        const u = new URLSearchParams(location.search);
        u.set("tune", JSON.stringify(t));
        u.set("palette", $("palSel").value);
        location.search = u.toString();
      };
      $("tuneDefault").onclick = () => {
        const u = new URLSearchParams(location.search);
        u.delete("tune");
        u.delete("palette");
        location.search = u.toString();
      };
      $("tuneSummary").textContent = `${PALETTE} · ${Object.entries(TUNE)
        .map(([k, v]) => k + " " + v)
        .join(" · ")}`;
    }

    // --- the list ---------------------------------------------------------------------------
    function renderList(running) {
      const res = (id) => LAB.cache.get(id);
      $("list").innerHTML =
        `<button data-id="suite" aria-current="${selected === "suite"}">${badge(all?.suite.status)}<span>suite</span></button><hr />` +
        SCENARIOS.map((s) => {
          const r = res(s.id);
          const n = r ? r.checks.filter((c) => c.status === "fail").length : 0;
          return `<button data-id="${s.id}" aria-current="${selected === s.id}">${badge(running === s.id ? "run" : r?.status)}<span>${esc(s.title)}</span><span class="muted">${n || ""}</span></button>`;
        }).join("");
    }
    $("list").onclick = (e) => {
      const b = e.target.closest("button[data-id]");
      if (b) void select(b.dataset.id);
    };

    async function select(id) {
      selected = id;
      renderList();
      if (id === "suite") renderSuite();
      else renderScenario(id);
      if (id !== "suite" && LAB.cache.get(id) && !busy) {
        await buildFlipbook(id);
        if (selected === id) openReplay(id);
      }
    }

    // --- suite overview -------------------------------------------------------------------------
    function renderSuite() {
      $("filmSection").innerHTML = "";
      if (!all) {
        $("detail").innerHTML = `<h2>suite</h2><p class="about">Running…</p>`;
        return;
      }
      const rows = all.results
        .map((r) => {
          const M = r.metrics;
          const closes = r.strokes.filter((k) => !k.partial).map((k) => k.closeMean);
          return `<tr><td>${badge(r.status)}</td><td><a href="#" data-go="${r.id}">${esc(r.id)}</a></td>
            <td class="num">${M.strokes}/${M.fleeStrokes}</td><td class="num">${fmt(M.vPeak, 1)}</td>
            <td class="num">${fmt(M.spreadMax)}</td><td class="num">${fmt(closes.length ? Math.min(...closes) : null)}</td>
            <td class="num">${fmt(M.stallFrac * 100, 1)}</td>
            <td class="num">${fmt(M.crossMid == null ? null : Math.max(M.crossMid, M.cross34))}</td>
            <td class="num">${fmt(M.crossTip)}</td><td class="num">${fmt(M.tipP99, 1)}</td>
            <td class="num">${fmt(M.nodeMax, 1)}</td><td class="num">${fmt(M.facingEdgeRestRunMax, 1)}</td>
            <td class="num">${fmt(M.archTurnMeanDeg, 1)}</td>
            <td class="spark" title="speed over time, scaled to its peak">${esc(M.speedSpark || "")}</td></tr>`;
        })
        .join("");
      const rests = all.suite.rests;
      $("detail").innerHTML = `
        <h2>suite</h2>
        <p class="about">Every scenario runs at a fixed ${Math.round(1 / DT)} Hz step from a seeded start, so a run repeats exactly. Lengths are in mantle lengths (ML), speeds in ML/s.</p>
        <h3>suite checks</h3>${checksTable(all.suite.checks)}
        <h3>scenarios</h3>
        <div class="scroll"><table><tr><th></th><th>scenario</th><th class="num">strokes</th><th class="num">v peak</th><th class="num">spread</th><th class="num">closed</th><th class="num">stall %</th><th class="num">x mid</th><th class="num">x tip</th><th class="num">tip p99</th><th class="num">pt max</th><th class="num">face s</th><th class="num">arch °</th><th>speed over time</th></tr>${rows}</table></div>
        <p class="muted">strokes = all/flee · spread = widest point off the axis · closed = the most-closed moment's mean tip offset · x mid / x tip = furthest past the midline while closing · face s = longest rest facing an edge</p>
        <h3>rest durations (${rests.length}, all scenarios)</h3>${hist(rests)}
        <h3>thresholds (lab/engine.js)</h3>
        <div class="metrics">${Object.entries(T)
          .map(([k, v]) => `<div><span>${k}</span><span>${v}</span></div>`)
          .join("")}</div>`;
      $("detail")
        .querySelectorAll("[data-go]")
        .forEach(
          (a) =>
            (a.onclick = (e) => {
              e.preventDefault();
              void select(a.dataset.go);
            }),
        );
    }

    function hist(xs) {
      if (!xs.length) return `<p class="muted">no complete rests</p>`;
      const bin = T.restBin,
        lo = Math.floor(Math.min(...xs) / bin),
        hi = Math.floor(Math.max(...xs) / bin);
      const counts = Array.from({ length: hi - lo + 1 }, () => 0);
      for (const x of xs) counts[Math.floor(x / bin) - lo]++;
      const max = Math.max(...counts);
      return `<div class="hist">${counts
        .map(
          (c, i) =>
            `<div title="${((lo + i) * bin).toFixed(1)}–${((lo + i + 1) * bin).toFixed(1)} s: ${c}" style="height:${(c / max) * 100}%;opacity:${c ? 1 : 0}"></div>`,
        )
        .join(
          "",
        )}</div><div class="hist-axis"><span>${(lo * bin).toFixed(1)} s</span><span>${((hi + 1) * bin).toFixed(1)} s</span></div>`;
    }

    function checksTable(checks) {
      return `<table><tr><th></th><th>check</th><th class="num">value</th><th>limit</th><th>note</th></tr>${checks
        .map(
          (c) =>
            `<tr><td>${badge(c.status)}</td><td>${esc(c.label)}</td><td class="num">${fmt(c.value, 3)}</td><td>${esc(c.limit)}</td><td class="note">${esc(c.note)}</td></tr>`,
        )
        .join("")}</table>`;
    }

    // --- one scenario ----------------------------------------------------------------------------
    function renderScenario(id) {
      const sc = SCENARIOS.find((s) => s.id === id);
      const r = LAB.cache.get(id);
      if (!r) {
        $("detail").innerHTML =
          `<h2>${esc(sc.title)}</h2><p class="about">${esc(sc.about)}</p><p class="muted">not run yet</p>`;
        $("filmSection").innerHTML = "";
        return;
      }
      const M = r.metrics;
      const groups = {
        body: {
          "mean speed": [M.vMean, 2, "ML/s"],
          "peak speed": [M.vPeak, 2, "ML/s"],
          "jerk p99": [M.jerkP99, 0, "ML/s³"],
          "jerk max": [M.jerkMax, 0, "ML/s³"],
          "turn accel max": [M.angAccMax, 1, "rad/s²"],
          "fear = 1 for": [M.fearOneS, 1, "s"],
          "still (< 0.3 ML/s)": [M.stillFrac * 100, 1, "%"],
          "longest still": [M.stillRunMax, 2, "s"],
          "longest rest": [M.restLongest, 2, "s"],
        },
        arms: {
          "widest point": [M.spreadMax, 2, "ML"],
          "tip speed p50": [M.tipP50, 2, "ML/s"],
          "tip speed p99": [M.tipP99, 2, "ML/s"],
          "tip speed max": [M.tipMax, 2, "ML/s"],
          "any point max": [M.nodeMax, 2, "ML/s"],
          "frames over flick": [M.flickFrames, 0, ""],
          "tip stall": [M.stallFrac * 100, 1, "%"],
          "mid past axis": [M.crossMid, 3, "ML"],
          "3/4 past axis": [M.cross34, 3, "ML"],
          "tip past axis": [M.crossTip, 3, "ML"],
          "self-crossing": [M.selfCrossFrac * 100, 1, "% frames"],
          "arms crossing (side, layer)": [M.sideCrossFrac * 100, 1, "% frames"],
        },
        "edges & rest": {
          "min to left": [M.minEdge.left, 2, "ML"],
          "min to right": [M.minEdge.right, 2, "ML"],
          "min to top": [M.minEdge.top, 2, "ML"],
          "min to bottom": [M.minEdge.bottom, 2, "ML"],
          "facing an edge": [M.facingEdgeS, 2, "s"],
          "longest at rest": [M.facingEdgeRestRunMax, 2, "s"],
          "off screen": [M.offscreenS, 2, "s"],
          resting: [M.restS, 1, "s"],
          "mantle-down at rest": [M.upsideRestS, 2, "s"],
          "…near top/bottom": [M.upsideEdgeRestS, 2, "s"],
        },
        arch: {
          source: [M.archSource, 0, ""],
          "mean in turns": [M.archTurnMeanDeg, 1, "°"],
          "turn frames": [M.archTurnFrames, 0, ""],
          "corr with turn": [M.archTurnCorr, 2, ""],
        },
      };
      const strokes = r.strokes
        .map(
          (k) =>
            `<tr><td class="num">${k.n}</td><td class="num"><a href="#" data-seek="${k.t0}">${fmt(k.t0)}</a></td><td>${k.hurry ? (k.flee >= 0 ? "flee #" + (k.flee + 1) : "flee") : "cruise"}${k.partial ? " (cut)" : ""}</td>
            <td class="num">${fmt(k.fear0)}</td><td class="num">${fmt(k.period)}</td><td class="num">${fmt(k.vMean)}</td><td class="num">${fmt(k.vPeak)}</td>
            <td class="num">${fmt(k.spreadMax)}</td><td class="num">${fmt(k.tipMax)}</td><td class="num">${fmt(k.closeMean)}</td><td class="num">${fmt(k.closeMax)}</td></tr>`,
        )
        .join("");
      $("detail").innerHTML = `
        <h2>${esc(sc.title)} ${badge(r.status)}</h2>
        <p class="about">${esc(sc.about)} <span class="muted">seed ${sc.seed} · ${sc.secs} s</span></p>
        <h3>checks</h3>${checksTable(r.checks)}
        <h3>anomaly flags <span class="muted">(click a time to see that frame)</span></h3>${flagsTable(r)}
        <h3>over time <span class="muted">(hover to read, click to seek the replay)</span></h3>
        <div class="charts" id="charts"></div><div id="readout"></div>
        <h3>metrics</h3>
        ${Object.entries(groups)
          .map(
            ([g, rows]) =>
              `<div class="muted" style="margin-top:8px">${g}</div><div class="metrics">${Object.entries(
                rows,
              )
                .map(
                  ([k, [v, d, u]]) =>
                    `<div><span>${k}</span><span>${fmt(v, d)}${u ? " " + u : ""}</span></div>`,
                )
                .join("")}</div>`,
          )
          .join("")}
        <h3>strokes (${r.strokes.length})</h3>
        <div class="scroll"><table><tr><th class="num">#</th><th class="num">t</th><th>kind</th><th class="num">fear</th><th class="num">period</th><th class="num">v mean</th><th class="num">v peak</th><th class="num">spread</th><th class="num">tip max</th><th class="num">closed</th><th class="num">closed max</th></tr>${strokes}</table></div>
        <p class="muted">spread = widest point off the axis; closed = the stroke's most-closed mean tip offset (closed max: the furthest tip at that moment). ML and ML/s.</p>
        <h3>rests (${r.rests.length})</h3><p>${r.rests.length ? r.rests.map((x) => x.toFixed(2) + " s").join(" · ") : '<span class="muted">none complete</span>'}</p>`;
      $("detail")
        .querySelectorAll("[data-seek]")
        .forEach(
          (a) =>
            (a.onclick = (e) => {
              e.preventDefault();
              void seek(+a.dataset.seek);
            }),
        );
      charts(r);
      const url = r.sheet ? r.sheet.toDataURL("image/png") : null;
      const img = (c) => (c ? c.toDataURL("image/png") : "");
      $("filmSection").innerHTML = `
        <h3>every frame <span class="muted">(← → step, shift ×10, space plays; red ticks: motion flags, amber: pose flags)</span></h3>
        <div class="flip" id="flip">
          <canvas id="flipView" width="480" height="508"></canvas>
          <div class="flip-side">
            <div class="controls">
              <button id="flipPrev">◀</button><button id="flipPlay">play</button><button id="flipNext">▶</button>
              <label><input type="checkbox" id="flipOnion" /> onion (last 8)</label>
              <button id="flipSeek">replay from here</button>
            </div>
            <p id="flipInfo" class="muted">building…</p>
            <canvas id="flipLine" height="34"></canvas>
          </div>
        </div>
        ${url ? `<h3>filmstrip <span class="muted">(click to toggle full size)</span></h3><div class="film" id="film"><img alt="contact sheet for ${esc(id)}" src="${url}" /></div>` : ""}
        <div class="pair">
          <div><h3>onion skin</h3><img class="onion" alt="onion skin" src="${img(r.onion)}" /></div>
          <div class="grow"><h3>traces <span class="muted">(click to toggle full size)</span></h3><div class="film" id="traces"><img alt="trajectory traces" src="${img(r.traces && r.traces.canvas)}" /></div></div>
        </div>`;
      for (const f of ["film", "traces"]) {
        const el = $(f);
        if (el) el.onclick = () => el.classList.toggle("big");
      }
      $("detail")
        .querySelectorAll("[data-frame]")
        .forEach(
          (a) =>
            (a.onclick = (e) => {
              e.preventDefault();
              flipToStep(+a.dataset.frame);
            }),
        );
      wireFlip();
    }

    function flagsTable(r) {
      const c = r.flags.counts;
      const rows = Object.entries(LAB.FLAGS)
        .map(([k, [bit, code, what]]) => {
          const evs = r.flags.worst.filter((e) => e.kind === k);
          const motion = bit & LAB.MOTION;
          return `<tr><td><span class="badge ${c[k].frames ? (motion ? "fail" : "warn") : "pass"}">${code}</span></td>
            <td class="num">${c[k].frames}</td><td class="num">${c[k].events}</td>
            <td>${evs.map((e) => `<a href="#" data-frame="${e.step}">${e.t.toFixed(2)} s</a> <span class="muted">${fmt(e.value, 2)}</span>`).join(" · ")}</td>
            <td class="note">${esc(what)}</td></tr>`;
        })
        .join("");
      return `<div class="scroll"><table><tr><th></th><th class="num">frames</th><th class="num">events</th><th>worst (value)</th><th>what</th></tr>${rows}</table></div>`;
    }

    // --- the flipbook: every frame of the run, from atlases made while it re-runs -----------------
    let flip = null; // { id, meta, atlases: Blob[], bitmaps: Map, frame, playing }
    const flipCache = new Map(); // id -> flip, for this page
    async function buildFlipbook(id) {
      if (flipCache.has(id)) {
        flip = flipCache.get(id);
        wireFlip();
        return;
      }
      busy = true;
      $("play").disabled = $("scrub").disabled = true;
      const atlases = [];
      const blob = (c) => new Promise((res) => c.toBlob(res, "image/png"));
      const r = await LAB.run(id, {
        film: false,
        keep: false,
        flip: async (c, k) => (atlases[k] = await blob(c)),
        onProgress: (p) => {
          if ($("flipInfo"))
            $("flipInfo").textContent = `building every frame… ${Math.round(p * 100)}%`;
        },
      });
      busy = false;
      flip = {
        id,
        meta: r.flip.frames,
        geo: r.flip,
        atlases,
        bitmaps: new Map(),
        frame: 0,
        playing: false,
      };
      flipCache.set(id, flip);
      if (selected === id) wireFlip();
    }
    async function atlasBitmap(k) {
      if (!flip.bitmaps.has(k)) {
        if (flip.bitmaps.size > 6) {
          const [old] = flip.bitmaps.keys();
          flip.bitmaps.get(old).close?.();
          flip.bitmaps.delete(old);
        }
        flip.bitmaps.set(k, await createImageBitmap(flip.atlases[k]));
      }
      return flip.bitmaps.get(k);
    }
    async function drawFrameInto(g, f, x, y, scale, withLabel = true) {
      const G = flip.geo,
        k = f % G.perAtlas;
      const bm = await atlasBitmap(Math.floor(f / G.perAtlas));
      const h = G.tile + (withLabel ? G.label : 0);
      g.drawImage(
        bm,
        (k % G.cols) * G.tile,
        Math.floor(k / G.cols) * h,
        G.tile,
        h,
        x,
        y,
        G.tile * scale,
        h * scale,
      );
    }
    async function showFrame(f) {
      if (!flip || !$("flipView") || selected !== flip.id) return;
      f = Math.max(0, Math.min(flip.meta.length - 1, f));
      flip.frame = f;
      const g = $("flipView").getContext("2d");
      g.imageSmoothingEnabled = false;
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 1;
      g.fillStyle = "#171716";
      g.fillRect(0, 0, 480, 508);
      if ($("flipOnion").checked) {
        g.globalCompositeOperation = "lighten";
        for (let d = 8; d >= 1; d--)
          if (f - d >= 0) {
            g.globalAlpha = 0.5 * (1 - d / 9);
            await drawFrameInto(g, f - d, 0, 0, 2, false);
          }
        g.globalAlpha = 1;
      }
      await drawFrameInto(g, f, 0, 0, 2);
      g.globalCompositeOperation = "source-over";
      const [step, bits] = flip.meta[f];
      $("flipInfo").textContent =
        `frame ${f + 1} / ${flip.meta.length} · step ${step} · ${(step * DT).toFixed(3)} s · every ${flip.geo.every} steps (${Math.round(1 / (flip.geo.every * DT))} fps)${bits ? " · " + LAB.flagCodes(bits).join(" ") : ""}`;
      drawFlipLine();
    }
    function drawFlipLine() {
      const c = $("flipLine");
      if (!c || !flip) return;
      const dpr = devicePixelRatio || 1,
        w = c.clientWidth,
        h = 34;
      c.width = w * dpr;
      c.height = h * dpr;
      const g = c.getContext("2d");
      g.scale(dpr, dpr);
      g.fillStyle = "rgba(240,236,229,.05)";
      g.fillRect(0, 0, w, h);
      const n = flip.meta.length;
      flip.meta.forEach(([, bits], f) => {
        if (!bits) return;
        g.fillStyle = bits & LAB.MOTION ? "#e66a5c" : "#d9b25c";
        const x = (f / n) * w;
        if (bits & LAB.MOTION) g.fillRect(x, 4, Math.max(1, w / n), 14);
        else g.fillRect(x, 20, Math.max(1, w / n), 6);
      });
      g.fillStyle = "#f0ece5";
      g.fillRect((flip.frame / n) * w - 1, 0, 2, h);
    }
    function flipToStep(step) {
      if (!flip) return;
      let f = flip.meta.findIndex(([s]) => s >= step);
      if (f < 0) f = flip.meta.length - 1;
      void showFrame(f);
      $("flip")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    function wireFlip() {
      if (!$("flipView")) return;
      if (!flip || flip.id !== selected) {
        $("flipInfo").textContent = "building…";
        return;
      }
      const line = $("flipLine");
      const pick = (e) => {
        const b = line.getBoundingClientRect();
        void showFrame(Math.round(((e.clientX - b.left) / b.width) * (flip.meta.length - 1)));
      };
      line.onmousedown = (e) => {
        pick(e);
        line.onmousemove = (ev) => ev.buttons && pick(ev);
      };
      $("flipPrev").onclick = () => showFrame(flip.frame - 1);
      $("flipNext").onclick = () => showFrame(flip.frame + 1);
      $("flipOnion").onchange = () => showFrame(flip.frame);
      $("flipSeek").onclick = () => seek(flip.meta[flip.frame][0] * DT + DT);
      $("flipPlay").onclick = () => toggleFlipPlay();
      void showFrame(flip.frame);
    }
    function toggleFlipPlay() {
      if (!flip) return;
      flip.playing = !flip.playing;
      $("flipPlay").textContent = flip.playing ? "pause" : "play";
      if (!flip.playing) return;
      const me = flip;
      let last = performance.now();
      const tick = async (now) => {
        if (!me.playing || flip !== me) return;
        const fps = 1 / (me.geo.every * DT);
        const k = Math.floor(((now - last) / 1000) * fps * +$("speed").value);
        if (k > 0) {
          last = now;
          if (me.frame + k >= me.meta.length) {
            me.playing = false;
            $("flipPlay").textContent = "play";
          }
          await showFrame(me.frame + k);
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
    addEventListener("keydown", (e) => {
      if (!flip || !$("flipView") || flip.id !== selected) return;
      if (e.target.closest && e.target.closest("input, select, textarea, button")) return;
      const d = e.shiftKey ? 10 : 1;
      if (e.key === "ArrowRight") void showFrame(flip.frame + d);
      else if (e.key === "ArrowLeft") void showFrame(flip.frame - d);
      else if (e.key === " ") toggleFlipPlay();
      else return;
      e.preventDefault();
    });

    // --- charts: small multiples over one time axis ----------------------------------------------
    let chartState = null;
    function charts(r) {
      const col = Object.fromEntries(r.seriesCols.map((k, i) => [k, i]));
      const S = r.series;
      const defs = [
        { key: "speed", label: "speed ML/s", lo: 0 },
        {
          key: "spread",
          label: "widest point off the axis, ML (dashed: REACH)",
          lo: 0,
          lines: [r.REACH],
        },
        {
          key: "nodeSpeed",
          label: "fastest arm point vs body, ML/s (dashed: flick)",
          lo: 0,
          lines: [T.flick],
        },
        { key: "fear", label: "fear", lo: 0, hi: 1 },
        {
          key: "heading",
          label: "heading, ° from mantle-up (dashed: mantle-down line)",
          lo: -180,
          hi: 180,
          lines: [-125, 0, 125],
        },
        { key: "arch", label: `arch ° (${r.metrics.archSource})` },
      ];
      const box = $("charts");
      box.innerHTML = defs.map(() => "<canvas></canvas>").join("");
      const cvs = [...box.querySelectorAll("canvas")];
      const t1 = S.at(-1)?.[0] || 1;
      chartState = { r, defs, cvs, col, S, t1, hover: null };
      const draw = () => drawCharts();
      cvs.forEach((c) => {
        c.onmousemove = (e) => {
          const b = c.getBoundingClientRect();
          chartState.hover = ((e.clientX - b.left) / b.width) * t1;
          draw();
        };
        c.onmouseleave = () => {
          chartState.hover = null;
          draw();
        };
        c.onclick = (e) => {
          const b = c.getBoundingClientRect();
          void seek(((e.clientX - b.left) / b.width) * t1);
        };
      });
      draw();
    }
    function drawCharts() {
      const cs = chartState;
      if (!cs || !document.body.contains(cs.cvs[0])) return;
      const dpr = devicePixelRatio || 1;
      const fg = css("--fg"),
        accent = css("--accent");
      const at = cs.hover ?? (replay && replay.id === cs.r.id ? replay.ses.t : null);
      const idx =
        at == null
          ? -1
          : Math.min(cs.S.length - 1, Math.max(0, Math.round((at / cs.t1) * (cs.S.length - 1))));
      const read = [];
      cs.defs.forEach((d, n) => {
        const c = cs.cvs[n];
        const w = c.clientWidth,
          h = c.clientHeight;
        c.width = w * dpr;
        c.height = h * dpr;
        const g = c.getContext("2d");
        g.scale(dpr, dpr);
        const k = cs.col[d.key];
        const ys = cs.S.map((row) => row[k]);
        let lo = d.lo ?? Math.min(...ys),
          hi = d.hi ?? Math.max(...ys, ...(d.lines || []));
        if (hi - lo < 1e-6) hi = lo + 1;
        const top = 14,
          bot = h - 2;
        const X = (t) => (t / cs.t1) * w,
          Y = (v) => bot - ((v - lo) / (hi - lo)) * (bot - top);
        // mode bands: swimming faint, fleeing warmer
        const mc = cs.col.mode;
        for (let i = 0; i < cs.S.length;) {
          const m = cs.S[i][mc];
          let j = i;
          while (j < cs.S.length && cs.S[j][mc] === m) j++;
          if (m) {
            g.fillStyle = m === 2 ? "rgba(229,129,63,.10)" : "rgba(240,236,229,.04)";
            g.fillRect(
              X(cs.S[i][0]),
              top,
              X(cs.S[Math.min(j, cs.S.length - 1)][0]) - X(cs.S[i][0]),
              bot - top,
            );
          }
          i = j;
        }
        g.strokeStyle = "rgba(240,236,229,.25)";
        g.setLineDash([3, 4]);
        g.lineWidth = 1;
        for (const v of d.lines || []) {
          if (v < lo || v > hi) continue;
          g.beginPath();
          g.moveTo(0, Y(v));
          g.lineTo(w, Y(v));
          g.stroke();
        }
        g.setLineDash([]);
        g.strokeStyle = accent;
        g.lineWidth = 1.5;
        g.lineJoin = "round";
        g.beginPath();
        cs.S.forEach((row, i) =>
          i ? g.lineTo(X(row[0]), Y(row[k])) : g.moveTo(X(row[0]), Y(row[k])),
        );
        g.stroke();
        g.fillStyle = "rgba(240,236,229,.5)";
        g.font = '10px "Geist Mono", monospace';
        g.fillText(d.label, 0, 10);
        g.textAlign = "right";
        g.fillText(`${+hi.toFixed(2)}`, w, 10);
        if (idx >= 0) {
          const row = cs.S[idx];
          g.strokeStyle = fg;
          g.globalAlpha = 0.5;
          g.beginPath();
          g.moveTo(X(row[0]), top);
          g.lineTo(X(row[0]), bot);
          g.stroke();
          g.globalAlpha = 1;
          read.push(`${d.key} ${row[k]}`);
        }
      });
      $("readout").textContent =
        idx >= 0
          ? `t ${cs.S[idx][0].toFixed(2)} s · ${["rest", "swim", "flee"][cs.S[idx][cs.col.mode]]} · ${read.join(" · ")}`
          : "";
    }
    addEventListener("resize", () => {
      drawCharts();
      drawFlipLine();
      fitScreen();
    });

    // --- replay ---------------------------------------------------------------------------------
    let replay = null; // { id, sc, ses, playing, token }
    const screen = $("screen"),
      overlay = $("overlay");
    function fitScreen() {
      const w = screen.clientWidth;
      screen.style.height = (w * H) / W + "px";
      overlay.width = w * (devicePixelRatio || 1);
      overlay.height = ((w * H) / W) * (devicePixelRatio || 1);
      placeView();
    }
    // the iframe's transform: the whole screen, or 2.5× around the body
    let view = { k: 1, ox: 0, oy: 0 };
    function placeView() {
      const w = screen.clientWidth,
        base = w / W;
      const s = replay && replay.ses.snap;
      if ($("zoom").checked && s) {
        const k = base * 2.5;
        view = { k, ox: w / 2 - s.x * k, oy: (w * H) / W / 2 - s.y * k };
      } else view = { k: base, ox: 0, oy: 0 };
      iframe.style.transform = `translate(${view.ox}px, ${view.oy}px) scale(${view.k})`;
      drawOverlay();
    }
    function drawOverlay() {
      const g = overlay.getContext("2d");
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, overlay.width, overlay.height);
      if (!replay || !$("ovl").checked) return;
      const s = replay.ses.snap,
        st = replay.ses.st;
      const dpr = devicePixelRatio || 1;
      g.setTransform(view.k * dpr, 0, 0, view.k * dpr, view.ox * dpr, view.oy * dpr);
      const lw = 1 / view.k;
      const f0 = Math.cos(LAB.armAxis(s)),
        f1 = Math.sin(LAB.armAxis(s)),
        n0 = -f1,
        n1 = f0;
      const R = (s.REACH ?? 2.25) * s.ML;
      // the axis and the REACH band
      g.lineWidth = lw;
      g.setLineDash([4 * lw, 5 * lw]);
      g.strokeStyle = "rgba(240,236,229,.35)";
      for (const off of [-R, R]) {
        g.beginPath();
        g.moveTo(s.x + n0 * off + f0 * s.ML * 1.5, s.y + n1 * off + f1 * s.ML * 1.5);
        g.lineTo(s.x + n0 * off - f0 * s.ML * 4.5, s.y + n1 * off - f1 * s.ML * 4.5);
        g.stroke();
      }
      g.strokeStyle = "rgba(240,236,229,.2)";
      g.beginPath();
      g.moveTo(s.x + f0 * s.ML * 1.5, s.y + f1 * s.ML * 1.5);
      g.lineTo(s.x - f0 * s.ML * 4.5, s.y - f1 * s.ML * 4.5);
      g.stroke();
      g.setLineDash([]);
      // tips
      g.fillStyle = "#e5813f";
      for (const p of s.arms) {
        const j = p.length - 2;
        g.beginPath();
        g.arc(p[j], p[j + 1], 3 * lw, 0, 7);
        g.fill();
      }
      // the pointer, and where a click landed
      for (const [pt, col] of [
        [st.p, "#7cc58f"],
        [st.mark, "#d9b25c"],
      ])
        if (pt) {
          g.strokeStyle = col;
          g.lineWidth = 1.5 * lw;
          g.beginPath();
          g.arc(pt[0], pt[1], 8 * lw, 0, 7);
          g.stroke();
        }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = "rgba(240,236,229,.7)";
      g.font = '11px "Geist Mono", monospace';
      const v = Math.hypot(s.vx, s.vy) / s.ML;
      g.fillText(
        `${s.mode}${s.hurry ? " (flee)" : ""} · p ${(s.phase || 0).toFixed(2)} · v ${v.toFixed(2)} · fear ${s.fear.toFixed(2)} · tips ${LAB.tipSpreadOf(s).toFixed(2)} ML${s.scroll ? " · scroll " + Math.round(s.scroll) + " px/s" : ""}`,
        8,
        16,
      );
    }
    for (const id of ["ovl", "zoom"]) $(id).onchange = placeView;

    function openReplay(id) {
      if (busy || !LAB.stage?.sea) return;
      stop();
      const sc = SCENARIOS.find((s) => s.id === id);
      replay = { id, sc, ses: LAB.session(sc), playing: false, token: 0 };
      $("scrub").max = sc.secs;
      $("scrub").step = DT;
      $("scrub").value = 0;
      $("scrub").disabled = $("play").disabled = false;
      LAB.stage.sea.lab.step(DT, 0); // draw the start
      showTime();
      placeView();
    }
    function showTime() {
      if (!replay) return;
      $("time").textContent = replay.ses.t.toFixed(2) + " s";
      $("scrub").value = replay.ses.t;
      drawCharts();
    }
    function stop() {
      if (replay) {
        replay.playing = false;
        replay.token++;
      }
      $("play").textContent = "play";
    }
    $("play").onclick = () => {
      if (!replay) return;
      if (replay.playing) return stop();
      if (replay.ses.t >= replay.sc.secs - DT) replay.ses.reset();
      replay.playing = true;
      $("play").textContent = "pause";
      const token = ++replay.token;
      let last = performance.now(),
        acc = 0;
      const tick = (now) => {
        if (!replay || replay.token !== token) return;
        acc += Math.min(0.1, (now - last) / 1000) * +$("speed").value;
        last = now;
        while (acc >= DT && replay.ses.t < replay.sc.secs) {
          replay.ses.advance();
          acc -= DT;
        }
        placeView();
        showTime();
        if (replay.ses.t >= replay.sc.secs - DT / 2) return stop();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    // seeking replays from the start: the run is deterministic, so this is the same moment
    async function seek(t) {
      if (!replay || busy) return;
      const wasPlaying = replay.playing;
      stop();
      const token = replay.token;
      t = Math.max(0, Math.min(replay.sc.secs, t));
      if (t < replay.ses.t) replay.ses.reset();
      $("replayNote").textContent = "seeking…";
      while (replay.ses.t < t - DT / 2) {
        for (let n = 0; n < 120 && replay.ses.t < t - DT / 2; n++) replay.ses.advance();
        showTime();
        await new Promise((r) => setTimeout(r, 0));
        if (!replay || replay.token !== token) return;
      }
      $("replayNote").textContent = "";
      placeView();
      showTime();
      if (wasPlaying) $("play").click();
    }
    $("scrub").oninput = () => seek(+$("scrub").value);

    // --- running ---------------------------------------------------------------------------------
    async function runAll() {
      busy = true;
      stop();
      replay = null;
      $("runAll").disabled = $("play").disabled = $("scrub").disabled = true;
      $("replayNote").textContent = "the stage is busy running the suite";
      all = null;
      flip = null;
      flipCache.clear();
      const t0 = performance.now();
      renderList();
      all = await LAB.runAll({
        onProgress(id, p, done) {
          $("progressText").textContent = `running ${id}… ${Math.round(p * 100)}%`;
          $("progressBar").style.width = p * 100 + "%";
          renderList(done ? null : id);
          if (done && selected === id) renderScenario(id);
        },
      });
      busy = false;
      const fails = [...all.results, all.suite].filter((r) => r.status === "fail").length;
      $("progressText").textContent =
        `${all.results.length} scenarios in ${((performance.now() - t0) / 1000).toFixed(1)} s · ${fails} failing`;
      $("progressBar").style.width = "0";
      $("runAll").disabled = false;
      $("replayNote").textContent = "";
      void select(selected);
    }
    $("runAll").onclick = runAll;

    void (async () => {
      fitScreen();
      renderList();
      renderSuite();
      const st = await LAB.attach(iframe, { tune: TUNE, palette: PALETTE });
      if (!st.sea) {
        $("progressText").innerHTML =
          `<span class="notice">unsupported: ${esc(st.unsupported)}</span>`;
        return;
      }
      if (st.win.matchMedia("(prefers-reduced-motion: reduce)").matches)
        $("replayNote").innerHTML =
          '<span class="notice">prefers-reduced-motion is on: octopus.js never starts running, so frights do nothing and the results are wrong.</span>';
      await runAll();
    })();
  }
}
