// playground.html: the tuning sidebar (tune.js) driving the octopus in the #stage iframe, plus a
// clock (pause, step, slow motion), pokes and a live readout from sea.lab.snapshot().
{
  const root = document.documentElement;
  const frame = document.getElementById("stage");
  const side = document.getElementById("side");
  const $ = (id) => document.getElementById(id);
  const { store } = window.octoTune;

  let sea = null; // the stage's `sea` once it swims
  const win = () => frame.contentWindow;
  const panel = window.octoTune(side, {
    sea: () => sea,
    canvas: () => win().document.getElementById("sea"),
  });

  // --- theme: this page and the water together, kept with the landing page's -----------------
  function setTheme(t) {
    root.dataset.theme = t;
    $("theme").textContent = t === "dark" ? "light" : "dark";
    store.set("pond-theme", t);
    if (!sea) return;
    win().document.documentElement.dataset.theme = t;
    sea.recolor();
  }
  $("theme").onclick = () => setTheme(root.dataset.theme === "dark" ? "light" : "dark");
  root.dataset.theme =
    store.get("pond-theme") ||
    (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  $("theme").textContent = root.dataset.theme === "dark" ? "light" : "dark";

  // --- the clock: at ×1 the octopus runs its own; slower or faster, it is paused and stepped
  // here by the scaled frame time, in substeps of at most 1/60 s ---------------------------------
  let playing = true,
    speed = 1,
    raf = 0;
  function drive() {
    cancelAnimationFrame(raf);
    $("play").textContent = playing ? "pause" : "play";
    $("step").disabled = playing;
    document
      .querySelectorAll("[data-speed]")
      .forEach((b) => b.setAttribute("aria-pressed", +b.dataset.speed === speed));
    if (!sea) return;
    if (!playing) return sea.lab.pause();
    if (speed === 1) return sea.lab.resume();
    sea.lab.pause();
    let prev = performance.now();
    const tick = (ms) => {
      const d = Math.min(0.05, Math.max(0, ms - prev) / 1000) * speed;
      prev = ms;
      const n = Math.max(1, Math.ceil(d * 60));
      if (d > 0) sea.lab.step(d / n, n);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }
  $("play").onclick = () => {
    playing = !playing;
    drive();
  };
  $("step").onclick = () => {
    sea?.lab.step(1 / 60);
    readout();
  };
  document.querySelectorAll("[data-speed]").forEach(
    (b) =>
      (b.onclick = () => {
        speed = +b.dataset.speed;
        drive();
      }),
  );

  // --- pokes -----------------------------------------------------------------------------------
  // a click just behind it, as if someone tapped the water there; the pointer is let go after a
  // moment so no phantom stays near it
  let letGo = 0;
  $("frighten").onclick = () => {
    if (!sea) return;
    const s = sea.lab.snapshot();
    const r = 40 + Math.random() * 40;
    sea.lab.click(s.x - Math.cos(s.th) * r, s.y - Math.sin(s.th) * r);
    clearTimeout(letGo);
    letGo = setTimeout(() => sea?.lab.pointer(), 1200);
  };
  // the same octopus, started over somewhere new with a fresh seed
  $("respawn").onclick = () => {
    if (!sea) return;
    const s = sea.lab.snapshot();
    sea.lab.seed((Math.random() * 2 ** 32) >>> 0);
    sea.lab.place(
      s.W * (0.25 + 0.5 * Math.random()),
      s.H * (0.25 + 0.5 * Math.random()),
      Math.random() * Math.PI * 2,
    );
    sea.lab.seed(null);
    drive();
    readout();
  };
  // a whole new animal: reload the water
  $("fresh").onclick = () => {
    sea = null;
    frame.contentWindow.location.reload();
  };

  // --- the readout, about four times a second --------------------------------------------------
  const deg = (a) => Math.round((((a * 180) / Math.PI) % 360) + 360) % 360;
  function readout() {
    if (!sea) return;
    const s = sea.lab.snapshot();
    const mode = s.hurry ? "flee" : s.mode;
    $("rMode").textContent = mode;
    $("rMode").className = s.hurry ? "flee" : "";
    const v = Math.hypot(s.vx, s.vy);
    $("rSpeed").textContent = `${Math.round(v)} px/s · ${(v / s.ML).toFixed(1)} ML/s`;
    $("rFear").textContent = `${Math.round(s.fear * 100)}%`;
    $("rHeading").textContent = `${deg(s.th)}°`;
    const swim = s.mode === "swim";
    $("rStroke").textContent = swim
      ? `${s.phase.toFixed(2)} of ${s.period.toFixed(2)} s · ${s.phase < s.pc ? "jet" : "glide"}`
      : `resting ${Math.max(0, s.rest).toFixed(1)} s`;
    $("rJet").style.width = `${Math.min(1, s.pc) * 100}%`;
    $("rPhase").style.left = `calc(${(swim ? s.phase : 0) * 100}% - 1px)`;
    $("rClock").textContent = `${s.t.toFixed(1)} s · ${s.W}×${s.H}`;
  }
  setInterval(readout, 250);

  // --- the water (again after "new octopus") ---------------------------------------------------
  async function attach() {
    const w = win();
    if (!w.ready) return;
    const s = await w.ready;
    w.document.documentElement.dataset.theme = root.dataset.theme;
    sea = s;
    panel.load();
    sea.recolor();
    drive();
    readout();
  }
  frame.addEventListener("load", () => void attach());
  if (frame.contentDocument?.readyState === "complete") void attach();

  // --- phones: the sheet folds to its header ---------------------------------------------------
  $("toggle").onclick = () => {
    const folded = side.classList.toggle("folded");
    $("toggle").textContent = folded ? "tune" : "hide";
    $("toggle").setAttribute("aria-expanded", !folded);
  };
  drive();
}
