// Headless octopus lab: runs every scenario of ../lab.html in an offscreen Electron window and
// prints a summary table. Exits 1 when a check fails. From the repo root:
//
//   apps/desktop/node_modules/.bin/electron apps/site/lab/run.cjs <outDir> [--octopus <file>] [--only cruise,chase-long] [--tune '{"speed":1}'] [--palette ink] [--size 1440x900] [--no-frames] [--no-sheets]
//
// It writes into <outDir>:
//   report.json                 metrics, checks, strokes, rests, 30 Hz series, anomaly flags (with
//                               each kind's worst events) for every scenario
//   <id>.png                    12-frame filmstrip of one stroke, cruise below for comparison
//   <id>-onion.png              those frames laid over each other
//   <id>-traces.png             trajectories of tips, 3/4 and mid points, mantle top and head over
//                               one stroke and the sharpest turn, body and screen frame
//   frames/<id>/NNN.png         every frame (60 fps; 30 fps for runs over 20 s), the tiled pixels
//                               around the body, mantle up, 10 x 10 per sheet; red = flagged
//   flags/<id>-<kind>.png       the worst event of each flag kind at full size, +-2 and 4 steps
//
// Runs use the octopus.js's own look (sea.defaults) with the lab's tuning over it (LAB.TUNE and
// LAB.PALETTE in engine.js: the user's motion settings and body size, set explicitly whatever
// the octopus.js defaults are); --tune merges sea.set() knobs over that.
// --octopus serves another copy of octopus.js in place of apps/site/octopus.js, e.g. a tagged one:
//   git show octopus-v6:apps/site/octopus.js > /tmp/v6.js && ... run.cjs out --octopus /tmp/v6.js
// The site is served from a private port; `pnpm dev:site` need not be running.
const { app, BrowserWindow } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const argv = process.argv.slice(process.argv.findIndex((a) => a.endsWith("run.cjs")) + 1);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv.splice(i, 2)[1] : null;
};
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv.splice(i, 1), true) : false;
};
const octopus = opt("--octopus");
const only = opt("--only");
const size = opt("--size") || "1440x900";
const tune = opt("--tune");
const palette = opt("--palette");
if (tune) JSON.parse(tune); // fail early on bad JSON
const sheets = !flag("--no-sheets");
const frames = !flag("--no-frames");
const outDir = argv[0];
if (!outDir) {
  console.error("usage: electron apps/site/lab/run.cjs <outDir> [--octopus <file>] [--only a,b]");
  process.exit(2);
}
const site = path.resolve(__dirname, "..");
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://lab");
  const p = decodeURIComponent(u.pathname);
  // the page hands back images as it makes them: POST /__save?name=<relative path>
  if (req.method === "POST" && p === "/__save") {
    const name = u.searchParams.get("name") || "";
    if (!/^[\w-]+(\/[\w.-]+)*\.png$/.test(name)) {
      res.writeHead(400);
      return res.end();
    }
    const dest = path.join(outDir, name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      fs.writeFileSync(dest, Buffer.concat(chunks));
      res.writeHead(204);
      res.end();
    });
    return;
  }
  const file =
    p === "/octopus.js" && octopus ? path.resolve(octopus) : path.join(site, path.normalize(p));
  if (!file.startsWith(site) && file !== path.resolve(octopus || "")) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, {
      "content-type": TYPES[path.extname(file)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(data);
  });
});

const pad = (s, n) => String(s ?? "").padEnd(n);
const num = (v, d = 2) => (v == null || !Number.isFinite(v) ? "-" : v.toFixed(d));

function summary(rep) {
  const cols = [
    ["scenario", 22],
    ["status", 7],
    ["strokes", 8],
    ["vPeak", 6],
    ["spread", 7],
    ["close", 6],
    ["stall%", 7],
    ["xMid", 6],
    ["xTip", 6],
    ["tipP99", 7],
    ["ptMax", 6],
    ["face", 5],
    ["jerk99", 7],
    ["arch°", 6],
  ];
  const lines = [cols.map(([n, w]) => pad(n, w)).join(" ")];
  for (const s of rep.scenarios) {
    const M = s.metrics;
    const closes = s.strokes.filter((k) => !k.partial).map((k) => k.closeMean);
    lines.push(
      [
        s.id,
        s.status.toUpperCase(),
        `${M.strokes}/${M.fleeStrokes}`,
        num(M.vPeak, 1),
        num(M.spreadMax),
        num(closes.length ? Math.min(...closes) : null),
        num(M.stallFrac * 100, 1),
        num(M.crossMid == null ? null : Math.max(M.crossMid, M.cross34)),
        num(M.crossTip),
        num(M.tipP99, 1),
        num(M.nodeMax, 1),
        num(M.facingEdgeRestRunMax, 1),
        num(M.jerkP99, 0),
        num(M.archTurnMeanDeg, 1),
      ]
        .map((v, i) => pad(v, cols[i][1]))
        .join(" "),
    );
  }
  lines.push("");
  lines.push(
    "units: ML (mantle lengths), ML/s; strokes = all/flee; close = most-closed mean tip offset; xMid = mid or 3/4 point past the axis while closing; face = longest run facing an edge at rest (s)",
  );
  lines.push("");
  for (const s of [...rep.scenarios, { id: "suite", checks: rep.suite.checks }])
    for (const c of s.checks)
      if (c.status === "fail" || c.status === "warn")
        lines.push(
          `${pad(c.status.toUpperCase(), 5)} ${pad(s.id, 18)} ${pad(c.label, 50)} ${c.value} (${c.limit})${c.note ? "  " + c.note : ""}`,
        );
  lines.push(
    "",
    "speed over time (each scenario scaled to its own peak; still = share and longest stretch below 0.3 ML/s, longest rest):",
  );
  for (const s of rep.scenarios) {
    const M = s.metrics;
    lines.push(
      `  ${pad(s.id, 14)} ${M.speedSpark}  peak ${num(M.vPeak, 1)} · still ${num(M.stillFrac * 100, 0)}% max ${num(M.stillRunMax, 1)}s · rest max ${num(M.restLongest, 1)}s`,
    );
  }
  lines.push("", "anomaly flags (frames flagged per kind; worst event):");
  for (const s of rep.scenarios) {
    const c = s.flags.counts;
    const parts = Object.keys(c)
      .filter((k) => c[k].frames)
      .map((k) => {
        const w = s.flags.worst.find((e) => e.kind === k);
        return `${k} ${c[k].frames}f @${w.t}s`;
      });
    lines.push(`  ${pad(s.id, 18)} ${parts.join(" · ") || "none"}`);
  }
  const sc = rep.suite.checks.map((c) => `${c.id} ${c.status} (${c.value})`).join(", ");
  lines.push("", `suite: ${sc}`, `rests: ${rep.suite.rests.join(" ")}`);
  return lines.join("\n");
}

app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.whenReady().then(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const [w, h] = size.split("x").map(Number);
  const win = new BrowserWindow({
    width: w + 400,
    height: h + 200,
    show: false,
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  win.webContents.setFrameRate(60);
  win.webContents.on("console-message", (e) => {
    if (e.level === "error") console.error("page:", e.message);
    else if (e.message.startsWith("lab: ")) console.error(e.message);
  });
  const url = `http://127.0.0.1:${server.address().port}/lab.html?headless=1&w=${w}&h=${h}`;
  await win.loadURL(url);
  const t0 = Date.now();
  const out = await win.webContents.executeJavaScript(`(async () => {
    const st = await LAB.attach(document.getElementById("stage"), {
      tune: { ...LAB.TUNE, ...${tune || "{}"} },
      palette: ${JSON.stringify(palette)} || LAB.PALETTE,
    });
    if (!st.sea) return { unsupported: st.unsupported };
    const blob = (c) => new Promise((r) => c.toBlob(r, "image/png"));
    const save = async (name, c) =>
      fetch("/__save?name=" + encodeURIComponent(name), { method: "POST", body: await blob(c) });
    const all = await LAB.runAll({
      film: ${sheets},
      only: ${JSON.stringify(only ? only.split(",") : null)},
      flip: ${frames} ? (id) => (c, k) => save("frames/" + id + "/" + String(k).padStart(3, "0") + ".png", c) : null,
      onProgress: (id, p, done) => done && console.log("lab: " + id + " " + done.status),
    });
    for (const r of all.results) {
      if (${sheets}) {
        await save(r.id + ".png", r.sheet);
        await save(r.id + "-onion.png", r.onion);
        await save(r.id + "-traces.png", r.traces.canvas);
      }
      // the worst event of each flag kind, at full size
      const top = Object.values(
        Object.fromEntries([...r.flags.worst].reverse().map((e) => [e.kind, e])),
      );
      if (!top.length) continue;
      const shots = await LAB.grab(r.id, top.map((e) => e.step), (step) =>
        top.filter((e) => e.step === step).map((e) => e.code + " " + e.value + " (limit " + e.limit + ")").join(", "));
      for (const e of top) {
        e.crop = "flags/" + r.id + "-" + e.kind + ".png";
        await save(e.crop, shots.get(e.step));
      }
    }
    return { rep: LAB.report(all, { source: ${JSON.stringify(octopus || "apps/site/octopus.js")}, when: new Date().toISOString() }) };
  })()`);
  if (out.unsupported) {
    console.log(`unsupported: ${out.unsupported} (${octopus || "apps/site/octopus.js"})`);
    app.exit(3);
    return;
  }
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(out.rep, null, 1));
  console.log(
    `tune: ${out.rep.palette} ${JSON.stringify(out.rep.tune)}; fright radius ${out.rep.radii.near} px, click ${out.rep.radii.click} px\n`,
  );
  console.log(summary(out.rep));
  console.log(
    `\n${out.rep.scenarios.length} scenarios in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${path.resolve(outDir)}`,
  );
  const failed = [...out.rep.scenarios, out.rep.suite].some((s) => s.status === "fail");
  app.exit(failed ? 1 : 0);
});
