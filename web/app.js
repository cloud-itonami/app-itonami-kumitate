// kumitate's browser layer (JUN-346, JUN-353 Phase 3).
//
// This file only moves text and draws: every answer comes from the Kotoba
// module kumitate.wasm (the same `kumitate` command as the native build:
// validate, plan, process, runs, junit), run in a Worker by kotoba-host.js
// (Amu's runtime/wasm32-browser-static-host.js). It computes nothing about
// CircleCI itself, so the browser and the native command cannot disagree.
//
// The entry ABI (Amu seed/82): the page grants the run its own data only:
// 37/39 (stdout, stderr), 38 (the arguments) and 35 read-only (the files
// below, held in this page's memory). kotoba:host/cap refuses every other
// capability until the shared consent broker lands (JUN-353 Phase 2). There
// is no fetch here and the CSP forbids one (connect-src 'none').
"use strict";
(() => {
  const $ = (id) => document.getElementById(id);
  const RUN_LIMIT_MS = 30000;
  const ALLOW = [35, 37, 38, 39];

  // ---- the module ----
  let modulePromise = null;
  function hex(buf) {
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  async function loadModule() {
    const pinned = window.KUMITATE_WASM;
    if (!pinned || !pinned.base64) throw new Error("kumitate.wasm.js is missing");
    const bytes = Uint8Array.from(atob(pinned.base64), (c) => c.charCodeAt(0));
    if (!window.crypto || !window.crypto.subtle) {
      throw new Error("Cannot verify kumitate.wasm: WebCrypto SHA-256 is unavailable");
    }
    const digest = hex(await window.crypto.subtle.digest("SHA-256", bytes));
    if (digest !== pinned.sha256) throw new Error("kumitate.wasm digest mismatch: " + digest);
    const module = await WebAssembly.compile(bytes);
    $("runtime").textContent = "Module kumitate.wasm, " + bytes.length + " bytes, sha256 " + pinned.sha256 +
      " (verified); built by " + (pinned.compiler || "the Amu selfhost root") + ".";
    return module;
  }
  function moduleReady() {
    if (!modulePromise) modulePromise = loadModule();
    return modulePromise;
  }

  // ---- one run of the command in a fresh Worker ----
  const hostUrl = URL.createObjectURL(new Blob(["(" + kotobaWasm32BrowserStaticHost.toString() + ")()"],
                                               { type: "text/javascript" }));
  async function kumitate(args, files) {
    const module = await moduleReady();
    const t0 = performance.now();
    const r = await new Promise((resolve) => {
      const worker = new Worker(hostUrl);
      const timer = setTimeout(() => { worker.terminate(); resolve({ timeout: true }); }, RUN_LIMIT_MS);
      worker.onmessage = (e) => { clearTimeout(timer); worker.terminate(); resolve(e.data); };
      worker.onerror = (e) => { clearTimeout(timer); worker.terminate(); resolve({ hostError: String(e.message) }); };
      worker.postMessage({ module, fuel: 0, allow: ALLOW, args, files });
    });
    r.ms = Math.round(performance.now() - t0);
    if (r.timeout) throw new Error("the run took longer than " + RUN_LIMIT_MS / 1000 + " s and was stopped");
    if (r.hostError) throw new Error(r.hostError);
    const m = r.report && r.report.match(/^\{:status :ok :result (-?[0-9]+)/);
    if (r.exit !== 0 || !m) {
      throw new Error("the module stopped: " + ((r.stderr || "").trim() || r.wasmTrap || "exit " + r.exit));
    }
    r.code = Number(m[1]);
    return r;
  }
  async function kumitateJson(args, files) {
    const r = await kumitate(args, files);
    try { return Object.assign(JSON.parse(r.output), { _ms: r.ms }); }
    catch (e) { throw new Error("unexpected output: " + r.output.slice(0, 200)); }
  }

  // ---- small DOM helpers ----
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") n.className = v; else n.setAttribute(k, v === true ? "" : String(v));
    }
    for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) n.append(k instanceof Node ? k : String(k));
    return n;
  }
  const SVG = "http://www.w3.org/2000/svg";
  function svg(tag, attrs, ...kids) {
    const n = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined) n.setAttribute(k, String(v));
    for (const k of kids.flat()) if (k !== null && k !== undefined) n.append(k instanceof Node ? k : String(k));
    return n;
  }
  function table(head, rows, numeric) {
    const num = new Set(numeric || []);
    return el("div", { class: "table-wrap" }, el("table", null,
      el("thead", null, el("tr", null, head.map((h, i) => el("th", { class: num.has(i) ? "num" : null }, h)))),
      el("tbody", null, rows.map((r) => el("tr", null, r.map((c, i) => el("td", { class: num.has(i) ? "num" : null }, c ?? "")))))));
  }
  function status(id, text, err) {
    const n = $(id);
    n.textContent = text;
    n.classList.toggle("err", !!err);
  }
  function diagnostics(d) {
    const box = el("div");
    const errors = d.errors || [], warnings = d.warnings || [];
    box.append(el("p", null, d.valid
      ? el("span", { class: "badge ok" }, "accepted")
      : el("span", { class: "badge err" }, "refused"),
      " ", errors.length + " error" + (errors.length === 1 ? "" : "s") + ", " +
      warnings.length + " warning" + (warnings.length === 1 ? "" : "s")));
    const item = (x, kind) => el("li", null, el("span", { class: "badge " + kind }, kind === "err" ? "error" : "warning"), " ",
      el("code", { class: "code" }, x.code), " ", el("span", { class: "path" }, x.path || ""), el("div", null, x.message || ""));
    if (errors.length || warnings.length) {
      box.append(el("ul", { class: "diag" }, errors.map((x) => item(x, "err")), warnings.map((x) => item(x, "warn"))));
    }
    return box;
  }

  // ---- config: validate, plan, process ----
  // test/fixtures/config/accepted/docs-workflow-filters.yml
  const EXAMPLE = [
    "# After the CircleCI docs \"Using workflows to orchestrate jobs\": fan-out and",
    "# fan-in, an approval hold, branch and tag filters with regular expressions,",
    "# and a requirement that also runs on failure.",
    "version: 2.1",
    "executors:",
    "  base:",
    "    docker:",
    "      - image: cimg/base:2024.06",
    "jobs:",
    "  build:",
    "    executor: base",
    "    parallelism: 2",
    "    steps: [checkout, {run: make build}]",
    "  unit:",
    "    executor: base",
    "    parallelism: 4",
    "    steps: [checkout, {run: make unit}]",
    "  lint:",
    "    executor: base",
    "    steps: [checkout, {run: make lint}]",
    "  publish:",
    "    executor: base",
    "    steps: [checkout, {run: make publish}]",
    "  notify:",
    "    executor: base",
    "    steps:",
    "      - run: echo build finished",
    "workflows:",
    "  build-test-deploy:",
    "    jobs:",
    "      - build:",
    "          filters:",
    "            tags:",
    "              only: /^v[0-9]+\\.[0-9]+\\.[0-9]+$/",
    "      - unit:",
    "          requires: [build]",
    "          filters:",
    "            tags:",
    "              only: /^v.*/",
    "      - lint:",
    "          requires: [build]",
    "          filters:",
    "            branches:",
    "              ignore: /dependabot\\/.*/",
    "      - hold:",
    "          type: approval",
    "          requires: [unit, lint]",
    "          filters:",
    "            branches:",
    "              only: main",
    "            tags:",
    "              only: /^v.*/",
    "      - publish:",
    "          requires: [hold]",
    "          context: [registry]",
    "          filters:",
    "            branches:",
    "              only: [main, /release\\/.+/]",
    "            tags:",
    "              only: /^v.*/",
    "      - notify:",
    "          requires:",
    "            - build: [success, failed]",
    ""
  ].join("\n");

  function pipelineFlags() {
    const flags = [];
    const branch = $("branch").value.trim(), tag = $("tag").value.trim();
    if (branch) flags.push("--branch", branch);
    if (tag) flags.push("--tag", tag);
    for (const line of $("params").value.split("\n")) {
      const t = line.trim();
      if (t && t.indexOf("=") > 0) flags.push("--param", t);
    }
    return flags;
  }

  function renderPlan(plan) {
    const box = $("tab-plan");
    box.replaceChildren();
    const p = plan.pipeline || {};
    box.append(el("p", { class: "muted" }, "Pipeline: branch " + (p.branch ?? "undecided") + ", tag " + (p.tag ?? "undecided") +
      ", parameters " + JSON.stringify(p.parameters || {})));
    if (!(plan.workflows || []).length) box.append(el("p", null, "No workflow."));
    for (const w of plan.workflows || []) {
      box.append(el("h3", null, w.name, " ", w.run ? el("span", { class: "badge ok" }, "runs") : el("span", { class: "badge off" }, "does not run")));
      if (w.reason) box.append(el("p", { class: "muted" }, w.reason));
      if (w.run) {
        box.append(el("p", { class: "muted" }, "At most " + w.max_parallel_jobs + " jobs and " + w.max_parallel_containers +
          " containers at once. Levels, in order:"));
        box.append(el("div", { class: "levels" }, (w.levels || []).map((l, i) => el("span", { class: "level" }, i + ": " + l.join(", ")))));
      }
      box.append(table(["job", "runs", "level", "type", "executor", "parallelism", "steps", "requires"],
        (w.jobs || []).map((j) => [
          j.name + (j.name !== j.job ? " (" + j.job + ")" : ""),
          j.run ? "yes" : "no" + (j.reason ? ": " + j.reason : ""),
          String(j.level), j.type, j.executor, String(j.parallelism), String(j.steps),
          (j.requires || []).map((r) => r.name + (r.status && r.status.join(",") !== "success" ? " [" + r.status.join(", ") + "]" : "")).join(", ")]),
        [2, 5, 6]));
    }
  }

  // the workflow DAG: one column a level, an edge per requirement
  function renderDag(plan) {
    const box = $("tab-dag");
    box.replaceChildren();
    const W = 168, H = 46, GX = 64, GY = 16, PAD = 12;
    for (const w of plan.workflows || []) {
      box.append(el("h3", null, w.name, w.run ? "" : " (does not run)"));
      const jobs = w.jobs || [];
      const byLevel = new Map();
      for (const j of jobs) {
        if (!byLevel.has(j.level)) byLevel.set(j.level, []);
        byLevel.get(j.level).push(j);
      }
      const levels = [...byLevel.keys()].sort((a, b) => a - b);
      const pos = new Map();
      let rows = 0;
      levels.forEach((lv, col) => {
        byLevel.get(lv).forEach((j, row) => { pos.set(j.name, { x: PAD + col * (W + GX), y: PAD + row * (H + GY) }); });
        rows = Math.max(rows, byLevel.get(lv).length);
      });
      const width = PAD * 2 + levels.length * W + Math.max(0, levels.length - 1) * GX;
      const height = PAD * 2 + rows * H + Math.max(0, rows - 1) * GY;
      const g = svg("svg", { width, height, viewBox: "0 0 " + width + " " + height, role: "img",
        "aria-label": "Workflow " + w.name + ": " + jobs.length + " jobs in " + levels.length + " levels" });
      g.append(svg("defs", null, svg("marker", { id: "arrow-" + w.name, viewBox: "0 0 8 8", refX: 8, refY: 4, markerWidth: 7, markerHeight: 7, orient: "auto" },
        svg("path", { d: "M0,0 L8,4 L0,8 z", class: "arrow" }))));
      for (const j of jobs) {
        const to = pos.get(j.name);
        for (const r of j.requires || []) {
          const from = pos.get(r.name);
          if (!from || !to) continue;
          const x1 = from.x + W, y1 = from.y + H / 2, x2 = to.x, y2 = to.y + H / 2, mx = (x1 + x2) / 2;
          const any = r.status && r.status.join(",") !== "success";
          g.append(svg("path", { d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2 - 2},${y2}`, class: "edge" + (any ? " any" : ""),
            "marker-end": "url(#arrow-" + w.name + ")" }, svg("title", null, r.name + " -> " + j.name + " on " + (r.status || ["success"]).join(", "))));
        }
      }
      for (const j of jobs) {
        const p = pos.get(j.name);
        const cls = "node" + (j.type === "approval" ? " approval" : "") + (j.run ? "" : " off");
        const label = j.name.length > 22 ? j.name.slice(0, 21) + "…" : j.name;
        const meta = j.type === "approval" ? "approval" : (j.parallelism > 1 ? "x" + j.parallelism + " " : "") + (j.run ? "" : "not run");
        g.append(svg("g", { class: cls, transform: `translate(${p.x},${p.y})` },
          svg("title", null, j.name + (j.run ? "" : " (not run: " + (j.reason || "") + ")")),
          svg("rect", { width: W, height: H, rx: 7 }),
          svg("text", { x: 10, y: 19 }, label),
          svg("text", { x: 10, y: 36, class: "meta" }, meta || j.executor || "")));
      }
      box.append(el("div", { class: "dag" }, g));
    }
    box.append(el("p", { class: "muted" }, "Dashed edges also run when the required job fails. Dashed boxes do not run in this pipeline."));
  }

  async function runConfig() {
    const text = $("config").value;
    if (!text.trim()) { status("config-status", "Paste or open a config first.", true); return; }
    const button = $("run-config");
    button.disabled = true;
    status("config-status", "Running in the browser…");
    try {
      const files = { "/input/config.yml": text };
      const flags = pipelineFlags();
      const plan = await kumitateJson(["plan", "/input/config.yml", ...flags], files);
      $("config-out").hidden = false;
      $("diagnostics").replaceChildren(diagnostics(plan));
      renderPlan(plan);
      renderDag(plan);
      const proc = await kumitate(["process", "/input/config.yml", ...flags], files);
      const pbox = $("tab-process");
      pbox.replaceChildren();
      if (proc.code === 0) {
        pbox.append(el("p", { class: "muted" }, "The config as CircleCI's config process would expand it (version 2, matrix and parameters resolved)."),
          el("pre", { class: "yaml" }, proc.output));
      } else {
        pbox.append(el("p", null, "No processed config: the config is refused."));
      }
      status("config-status", "Done in " + (plan._ms + proc.ms) + " ms, in this browser.");
    } catch (e) {
      status("config-status", String(e.message || e), true);
    } finally {
      button.disabled = false;
    }
  }

  // ---- runs and JUnit ----
  function renderRuns(name, d) {
    const box = el("div");
    box.append(el("h3", null, name));
    box.append(diagnostics(d));
    const s = d.summary;
    if (!s) return box;
    box.append(el("p", null, s.workflows + " workflows, " + s.jobs + " jobs. Workflow status: " +
      Object.entries(s.workflow_status || {}).map(([k, v]) => k + " " + v).join(", ") + ". Job status: " +
      Object.entries(s.job_status || {}).map(([k, v]) => k + " " + v).join(", ") + "."));
    if ((s.by_job || []).length) {
      box.append(table(["job", "runs", "success", "failed", "success rate", "mean duration", "flaky"],
        s.by_job.map((j) => [j.name, String(j.runs), String(j.success), String(j.failed),
          (j.success_permille / 10).toFixed(1) + "%", j.mean_duration_ms === null ? "" : (j.mean_duration_ms / 1000).toFixed(1) + " s",
          j.flaky ? "flaky" : ""]), [1, 2, 3, 4, 5]));
    }
    if ((s.failed_jobs || []).length) {
      box.append(el("h3", null, "Failed jobs"));
      box.append(table(["job", "status", "job number", "workflow"],
        s.failed_jobs.map((j) => [j.name, j.status, String(j.job_number ?? ""), j.workflow_id || ""]), [2]));
    }
    return box;
  }
  function renderJunit(names, d) {
    const box = el("div");
    box.append(el("h3", null, "JUnit: " + names.join(", ")));
    box.append(diagnostics(d));
    if (!d.reports) return box;
    box.append(table(["report", "tests", "passed", "failed", "errors", "skipped", "time"],
      d.reports.map((r, i) => [names[i] || String(i), String(r.tests), String(r.passed), String(r.failed), String(r.errors), String(r.skipped),
        (r.time_ms / 1000).toFixed(2) + " s"]), [1, 2, 3, 4, 5, 6]));
    if ((d.failing || []).length) {
      box.append(el("h3", null, "Failing tests"));
      box.append(table(["test", "failures", "last message"], d.failing.map((t) => [t.test, String(t.failed), t.last_message || ""]), [1]));
    }
    if ((d.flaky || []).length) {
      box.append(el("h3", null, "Flaky tests (passed and failed across reports)"));
      box.append(table(["test", "passed", "failed"], d.flaky.map((t) => [t.test, String(t.passed), String(t.failed)]), [1, 2]));
    }
    if ((d.slowest || []).length) {
      box.append(el("h3", null, "Slowest tests"));
      box.append(table(["test", "longest"], d.slowest.map((t) => [t.test, (t.max_ms / 1000).toFixed(2) + " s"]), [1]));
    }
    return box;
  }
  async function runFiles(list) {
    const out = $("runs-out");
    out.replaceChildren();
    out.hidden = false;
    status("runs-status", "Running in the browser…");
    try {
      const texts = await Promise.all([...list].map(async (f) => ({ name: f.name, text: await f.text() })));
      const xml = texts.filter((t) => /\.xml$/i.test(t.name) || t.text.trimStart().startsWith("<"));
      const json = texts.filter((t) => !xml.includes(t));
      let ms = 0;
      for (const [i, t] of json.entries()) {
        const path = "/input/runs-" + i + ".json";
        const d = await kumitateJson(["runs", path], { [path]: t.text });
        ms += d._ms;
        out.append(renderRuns(t.name, d));
      }
      if (xml.length) {
        const files = {}, paths = [];
        xml.forEach((t, i) => { const p = "/input/junit-" + i + ".xml"; files[p] = t.text; paths.push(p); });
        const d = await kumitateJson(["junit", ...paths], files);
        ms += d._ms;
        out.append(renderJunit(xml.map((t) => t.name), d));
      }
      status("runs-status", texts.length + " file" + (texts.length === 1 ? "" : "s") + " in " + ms + " ms, in this browser.");
    } catch (e) {
      status("runs-status", String(e.message || e), true);
    }
  }

  // ---- wiring ----
  $("example").addEventListener("click", () => { $("config").value = EXAMPLE; $("config-name").textContent = "example"; });
  $("config-file").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    $("config").value = await f.text();
    $("config-name").textContent = f.name;
    e.target.value = "";
  });
  $("config").addEventListener("input", () => { $("config-name").textContent = ""; });
  $("run-config").addEventListener("click", runConfig);
  $("runs-file").addEventListener("change", (e) => { if (e.target.files.length) runFiles(e.target.files); e.target.value = ""; });
  for (const b of document.querySelectorAll(".tabs button")) {
    b.addEventListener("click", () => {
      for (const o of document.querySelectorAll(".tabs button")) o.setAttribute("aria-selected", String(o === b));
      for (const t of ["plan", "dag", "process"]) $("tab-" + t).hidden = t !== b.dataset.tab;
    });
  }
  moduleReady().catch((e) => { $("runtime").textContent = "The module could not be loaded: " + (e.message || e); });

  // for the headless check (test/browser): the same calls the buttons make
  window.kumitateUi = { kumitate, kumitateJson, runConfig, runFiles, ready: moduleReady };
})();
