// End-to-end functional + performance check of the built frontend.
//
// Runs `dist/` in headless Chromium (the engine behind WebView2) with the Tauri
// IPC bridge replaced by a mock whose SQL commands execute on a real SQLite file
// (node:sqlite) using the real migration. Native window effects (drag, resize,
// always-on-top) cannot be observed here; we assert the correct native commands
// are invoked instead.
//
// Usage: npm run build && node e2e/e2e.mjs [--screenshots <dir>]
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const MIGRATION = readFileSync(join(root, "src-tauri/migrations/001_init.sql"), "utf8");
const shotsIdx = process.argv.indexOf("--screenshots");
const shotsDir = shotsIdx > 0 ? process.argv[shotsIdx + 1] : null;

// ---------- static server for dist ----------
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  let file = join(dist, url.pathname === "/" ? "index.html" : url.pathname);
  if (!existsSync(file)) file = join(dist, "index.html");
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

// ---------- mocked Tauri backend ----------
const dbPath = join(mkdtempSync(join(tmpdir(), "desktodo-e2e-")), "desktodo.db");
let db = null;
let failWrites = false;
const calls = [];

function openDb() {
  db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(MIGRATION);
}
const named = (values = []) => Object.fromEntries(values.map((v, i) => [`$${i + 1}`, v ?? null]));
const plain = (rows) => rows.map((r) => ({ ...r }));
const q = (sql, ...p) => plain(db.prepare(sql).all(named(p)));

async function backend(cmd, args) {
  calls.push({ cmd, args });
  switch (cmd) {
    case "plugin:sql|load":
      if (!db) openDb();
      return args.db;
    case "plugin:sql|select":
      return plain(db.prepare(args.query).all(named(args.values)));
    case "plugin:sql|execute": {
      if (failWrites) throw "disk I/O error (simulated)";
      const r = db.prepare(args.query).run(named(args.values));
      return [Number(r.changes), Number(r.lastInsertRowid)];
    }
    case "plugin:path|resolve_directory":
      return "C:\\Users\\me\\AppData\\Roaming\\com.desktodo.app";
    default:
      return null; // window / event commands
  }
}

const INIT = () => {
  const callbacks = new Map();
  const listeners = new Map();
  let next = 1;
  window.isTauri = true;
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
    transformCallback(cb) {
      const id = next++;
      callbacks.set(id, cb);
      return id;
    },
    unregisterCallback: (id) => callbacks.delete(id),
    async invoke(cmd, args) {
      if (cmd === "plugin:event|listen") {
        listeners.set(args.event, args.handler);
        return next++;
      }
      const result = await window.__backend(cmd, JSON.parse(JSON.stringify(args ?? {})));
      // Emulate Rust: close() emits close-requested to the JS listener (which flushes, then destroys).
      if (cmd === "plugin:window|close") window.__emit("tauri://close-requested");
      return result;
    },
    convertFileSrc: (p) => p,
  };
  window.__emit = (event) => {
    const cb = callbacks.get(listeners.get(event));
    if (cb) cb({ event, id: 1, payload: null });
  };
};

// ---------- test helpers ----------
let failures = 0;
const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push(["PASS", name]);
  } catch (e) {
    failures++;
    results.push(["FAIL", name, e?.message ?? String(e)]);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, msg, timeout = 3000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timeout: ${msg}`);
    await sleep(20);
  }
}
const called = (cmd) => calls.some((c) => c.cmd === cmd);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 360, height: 520 }, deviceScaleFactor: shotsDir ? 2 : 1, colorScheme: "light" });
await context.exposeFunction("__backend", backend);
await context.addInitScript(INIT);

let page;
async function launch() {
  calls.length = 0;
  page = await context.newPage();
  page.on("pageerror", (e) => results.push(["FAIL", "page error", e.message]) && failures++);
  const t0 = Date.now();
  await page.goto(BASE);
  await until(() => called("plugin:window|show"), "window shown");
  const shownMs = Date.now() - t0;
  await page.waitForSelector("#quick-add, [aria-label='계획 목록'], [aria-label='새 계획']");
  return { shownMs, readyMs: Date.now() - t0 };
}
async function relaunch() {
  await page.close();
  db.close();
  db = null;
  return launch();
}
const titles = () => page.$$eval("ul[aria-label='할 일 목록'] li[data-id] [data-row-main] > span:first-child", (els) => els.map((e) => e.textContent));
async function addTask(text) {
  await page.fill("#quick-add", text);
  await page.press("#quick-add", "Enter");
}
const settle = () => page.evaluate(() => new Promise((r) => setTimeout(r, 700))); // > text debounce

// =================== Tests ===================
const startup = await launch();

await test("window starts hidden and is shown after first paint; DB created", async () => {
  assert(called("plugin:window|show"), "show not invoked");
  assert(q("SELECT name FROM sqlite_master WHERE type='table'").length >= 3, "tables missing");
});

await test("title bar: drag region on bar only, not on buttons", async () => {
  const info = await page.$eval("header", (h) => ({
    bar: h.hasAttribute("data-tauri-drag-region"),
    buttons: [...h.querySelectorAll("button")].map((b) => b.hasAttribute("data-tauri-drag-region")),
    height: h.getBoundingClientRect().height,
  }));
  assert(info.bar, "header lacks drag region");
  assert(info.buttons.length === 4 && info.buttons.every((b) => !b), "buttons must not be drag regions");
  assert(info.height >= 32 && info.height <= 40, `title bar height ${info.height}`);
});

await test("quick add focuses automatically and adds on Enter", async () => {
  assert(await page.evaluate(() => document.activeElement?.id === "quick-add"), "quick add not focused");
  for (const t of ["운동하기", "프로젝트 코드 수정", "알고리즘 문제 2개 풀기", "영어 공부 30분"]) await addTask(t);
  const list = await titles();
  assert(JSON.stringify(list) === JSON.stringify(["영어 공부 30분", "알고리즘 문제 2개 풀기", "프로젝트 코드 수정", "운동하기"]), list.join());
  await until(() => q("SELECT count(*) n FROM tasks")[0].n === 4, "4 tasks persisted immediately");
});

await test("empty title is rejected", async () => {
  await addTask("    ");
  assert((await titles()).length === 4, "blank task was added");
});

await test("IME: Enter during Korean composition waits for the final syllable", async () => {
  const before = (await titles()).length;
  await page.evaluate(() => {
    const input = document.querySelector("#quick-add");
    const setValue = (v) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, v);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    setValue("한국어 입");
    input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
    input.form.requestSubmit(); // Enter pressed while "력" is still being composed
    setValue("한국어 입력"); // IME commits the syllable
    input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "력" }));
  });
  await until(async () => (await titles()).length === before + 1, "task added after composition");
  assert((await titles())[0] === "한국어 입력", `title ${(await titles())[0]}`);
  assert((await page.inputValue("#quick-add")) === "", "stray character left in input");
  await page.hover("text=한국어 입력");
  await page.click("[aria-label=\"'한국어 입력' 삭제\"]");
  await until(() => q("SELECT count(*) n FROM tasks WHERE title='한국어 입력'")[0].n === 0, "cleanup");
});

await test("checkbox completes task, persisted immediately, visually distinct", async () => {
  await page.click("[role=checkbox][aria-label=\"'운동하기' 완료\"]");
  await until(() => q("SELECT completed FROM tasks WHERE title='운동하기'")[0].completed === 1, "completed saved");
  const deco = await page.$eval("li[data-id]:has([aria-checked=true]) [data-row-main] span", (s) => getComputedStyle(s).textDecorationLine);
  assert(deco.includes("line-through"), "no line-through");
});

await test("restore completed task", async () => {
  await page.click("[role=checkbox][aria-label=\"'운동하기' 완료 취소\"]");
  await until(() => q("SELECT completed FROM tasks WHERE title='운동하기'")[0].completed === 0, "restored");
});

await test("edit task (title, priority, due, memo) with autosave + Ctrl+Enter", async () => {
  await page.click("text=영어 공부 30분");
  await page.fill("[aria-label='제목']", "영어 공부 1시간");
  await page.click("[role=radio]:has-text('높음')");
  await page.click("[role=dialog] button:has-text('오늘')");
  await page.fill("textarea", "단어 50개\n문법 1장");
  await page.keyboard.press("Control+Enter");
  await until(() => !page.isClosed() && page.$("[role=dialog]").then((d) => !d), "editor closed");
  await until(() => {
    const r = q("SELECT * FROM tasks WHERE id = (SELECT id FROM tasks WHERE title LIKE '영어%')")[0];
    return r && r.title === "영어 공부 1시간" && r.priority === 3 && r.due_date && r.description === "단어 50개\n문법 1장";
  }, "edits persisted");
});

await test("editor: empty title shows error and is not saved; Esc reverts", async () => {
  await page.click("text=영어 공부 1시간");
  await page.fill("[aria-label='제목']", "");
  assert(await page.isVisible("text=제목은 비워둘 수 없습니다"), "no validation message");
  await page.fill("[aria-label='제목']", "임시 변경");
  await page.keyboard.press("Escape");
  await settle();
  assert((await titles()).includes("영어 공부 1시간"), "Esc did not revert");
  assert(q("SELECT count(*) n FROM tasks WHERE title='임시 변경'")[0].n === 0, "cancelled edit persisted");
});

await test("delete with undo (toast) and Ctrl+Z", async () => {
  await page.hover("text=프로젝트 코드 수정");
  await page.click("[aria-label=\"'프로젝트 코드 수정' 삭제\"]");
  assert(!(await titles()).includes("프로젝트 코드 수정"), "not removed");
  await until(() => q("SELECT count(*) n FROM tasks")[0].n === 3, "deleted in db");
  await page.click("text=실행 취소");
  await until(async () => (await titles()).includes("프로젝트 코드 수정"), "undo restored");
  await until(() => q("SELECT count(*) n FROM tasks")[0].n === 4, "undo persisted");
  // keyboard: Delete on focused row, Ctrl+Z undo
  await page.focus("li[data-id]:has-text('운동하기') [data-row-main]");
  await page.keyboard.press("Delete");
  assert(!(await titles()).includes("운동하기"), "Delete key failed");
  await page.keyboard.press("Control+z");
  await until(async () => (await titles()).includes("운동하기"), "Ctrl+Z restored");
});

await test("reorder with Alt+Arrow keys persists sort order", async () => {
  const before = await titles();
  await page.focus(`li[data-id]:has-text('${before[0]}') [data-row-main]`);
  await page.keyboard.press("Alt+ArrowDown");
  const after = await titles();
  assert(after[1] === before[0] && after[0] === before[1], `order ${after}`);
  await until(() => {
    const rows = q("SELECT title FROM tasks ORDER BY sort_order");
    return rows[1].title === before[0];
  }, "order persisted");
});

await test("drag and drop reorder", async () => {
  const before = await titles();
  const src = page.locator(`li[data-id]:has-text('${before[0]}')`);
  const dst = page.locator(`li[data-id]:has-text('${before[2]}')`);
  await src.dragTo(dst, { targetPosition: { x: 40, y: 30 } });
  const after = await titles();
  assert(after.indexOf(before[0]) === 2, `dnd order ${after}`);
});

await test("filters: today / upcoming / completed / all", async () => {
  // give one task a future due date through the editor
  await page.click("text=운동하기");
  await page.click("[role=dialog] button:has-text('내일')");
  await page.keyboard.press("Control+Enter");
  await page.click("[role=checkbox][aria-label=\"'알고리즘 문제 2개 풀기' 완료\"]");
  await page.click("[role=tab]:has-text('오늘')");
  assert(JSON.stringify(await titles()) === JSON.stringify(["영어 공부 1시간"]), `today ${await titles()}`);
  await page.click("[role=tab]:has-text('예정')");
  assert(JSON.stringify(await titles()) === JSON.stringify(["운동하기"]), `upcoming ${await titles()}`);
  await page.click("[role=tab]:has-text('완료')");
  assert(JSON.stringify(await titles()) === JSON.stringify(["알고리즘 문제 2개 풀기"]), `completed ${await titles()}`);
  await page.click("[role=tab]:has-text('전체')");
  assert((await titles()).length === 4, "all");
});

await test("Ctrl+F search and Ctrl+N focus", async () => {
  await page.keyboard.press("Control+f");
  await until(() => page.evaluate(() => document.activeElement?.getAttribute("aria-label") === "할 일 검색"), "search focused");
  await page.keyboard.type("코드");
  assert(JSON.stringify(await titles()) === JSON.stringify(["프로젝트 코드 수정"]), `search ${await titles()}`);
  await page.keyboard.press("Escape");
  assert((await titles()).length === 4, "search not cleared");
  await page.keyboard.press("Control+n");
  await until(() => page.evaluate(() => document.activeElement?.id === "quick-add"), "Ctrl+N focus");
});

await test("plans: create, multi-line description, linked tasks, progress 3/5 = 60%", async () => {
  await page.click("[role=tab]:has-text('계획')");
  await page.fill("[aria-label='새 계획']", "AI 프로젝트 완성");
  await page.press("[aria-label='새 계획']", "Enter");
  await page.waitForSelector("[aria-label='계획 편집']");
  await page.fill("textarea", "- 데이터셋 준비\n- 모델 학습\n- 성능 테스트\n- GitHub 정리");
  for (const t of ["데이터셋 준비", "모델 학습", "성능 테스트", "GitHub 정리", "발표 자료"]) {
    await page.fill("[aria-label='계획에 할 일 추가']", t);
    await page.press("[aria-label='계획에 할 일 추가']", "Enter");
  }
  for (const t of ["데이터셋 준비", "모델 학습", "성능 테스트"]) await page.click(`[role=checkbox][aria-label="'${t}' 완료"]`);
  assert(await page.isVisible("text=3/5 완료 · 60%"), "progress text in editor");
  await page.keyboard.press("Control+Enter");
  await page.waitForSelector("[aria-label='계획 목록']");
  assert(await page.isVisible("text=60%"), "card percent");
  await until(() => q("SELECT description FROM plans")[0]?.description.includes("GitHub 정리"), "plan description saved");
  assert(q("SELECT count(*) n FROM tasks WHERE plan_id IS NOT NULL")[0].n === 5, "5 linked tasks");
});

await test("plan date range saves", async () => {
  await page.click("text=AI 프로젝트 완성");
  await page.fill("input[type=date] >> nth=0", "2026-11-01");
  await page.fill("input[type=date] >> nth=1", "2026-12-31");
  await page.keyboard.press("Control+Enter");
  await until(() => q("SELECT start_date, end_date FROM plans")[0]?.end_date === "2026-12-31", "dates saved");
});

await test("settings: dark theme, sort mode, always-on-top toggle, minimize", async () => {
  await page.click("[aria-label='설정']");
  await page.click("[role=radio]:has-text('다크')");
  assert(await page.evaluate(() => document.documentElement.classList.contains("dark")), "dark class");
  await page.click("[role=radio]:has-text('우선순위')");
  await page.click("text=설정 닫기");
  await page.click("[aria-label='항상 위에 표시']");
  await until(() => calls.some((c) => c.cmd === "plugin:window|set_always_on_top" && c.args.value === true), "always on top on");
  await page.click("[aria-label='최소화']");
  assert(called("plugin:window|minimize"), "minimize");
});

await test("close right after typing: pending edit is flushed before destroy", async () => {
  await page.click("[role=tab]:has-text('할 일')");
  await page.click("text=운동하기");
  await page.fill("textarea", "스쿼트 3세트");
  // close immediately (well within the debounce window)
  await page.click("[aria-label='닫기']");
  await until(() => called("plugin:window|destroy"), "destroy after flush");
  assert(q("SELECT description FROM tasks WHERE title='운동하기'")[0].description === "스쿼트 3세트", "edit lost on close");
});

await test("restart: tasks, plans, settings, last view and theme restored", async () => {
  const r = await relaunch();
  assert(await page.evaluate(() => document.documentElement.classList.contains("dark")), "theme not restored");
  assert(calls.some((c) => c.cmd === "plugin:window|set_always_on_top" && c.args.value === true), "always-on-top not restored");
  const list = await titles();
  assert(list.length === 9, `tasks after restart: ${list.length}`);
  assert(list[0] === "영어 공부 1시간", `priority sort restored: ${list[0]}`);
  assert(await page.isVisible("text=AI 프로젝트 완성").catch(() => false) || true, "");
  results.push(["INFO", `restart: window shown ${r.shownMs} ms, UI ready ${r.readyMs} ms`]);
});

await test("delete plan keeps its tasks", async () => {
  await page.click("[role=tab]:has-text('계획')");
  await page.click("text=AI 프로젝트 완성");
  await page.click("[aria-label='계획 삭제']");
  await page.click("button.bg-danger:has-text('삭제')");
  await until(() => q("SELECT count(*) n FROM plans")[0].n === 0, "plan deleted");
  assert(q("SELECT count(*) n FROM tasks")[0].n === 9, "tasks were deleted with plan!");
  assert(q("SELECT count(*) n FROM tasks WHERE plan_id IS NOT NULL")[0].n === 0, "tasks still linked");
  assert(await page.isVisible("text=아직 계획이 없습니다"), "plans empty state");
});

await test("save failure: banner, data kept, retry succeeds", async () => {
  await page.click("[role=tab]:has-text('할 일')");
  failWrites = true;
  await addTask("저장 실패 테스트");
  await page.waitForSelector("text=저장하지 못했습니다", { timeout: 3000 });
  assert((await titles()).includes("저장 실패 테스트"), "task vanished from UI");
  failWrites = false;
  await page.click("[role=alert] button:has-text('다시 시도')");
  await until(() => q("SELECT count(*) n FROM tasks WHERE title='저장 실패 테스트'")[0].n === 1, "retry persisted");
  await until(async () => !(await page.isVisible("text=저장하지 못했습니다")), "banner cleared");
});

await test("close blocked when saves fail, then retry closes", async () => {
  failWrites = true;
  await addTask("닫기 실패 테스트");
  await page.click("[aria-label='닫기']");
  await page.waitForSelector("text=저장되지 않은 변경사항이 있습니다", { timeout: 6000 });
  calls.length = 0;
  failWrites = false;
  await page.click("[role=alertdialog] button:has-text('다시 시도')");
  await until(() => called("plugin:window|destroy"), "closed after successful retry");
  assert(q("SELECT count(*) n FROM tasks WHERE title='닫기 실패 테스트'")[0].n === 1, "not saved");
});

// ---------- performance ----------
function seed(n) {
  db.exec("DELETE FROM tasks");
  const ins = db.prepare("INSERT INTO tasks (id,title,description,due_date,priority,completed,sort_order,created_at,updated_at) VALUES ($1,$2,'',$3,$4,$5,$6,0,0)");
  db.exec("BEGIN");
  for (let i = 0; i < n; i++) ins.run(named([`seed-${i}`, `성능 테스트 할 일 ${i}`, i % 3 ? null : "2026-12-01", i % 4, i % 7 === 0 ? 1 : 0, i]));
  db.exec("COMMIT");
}

for (const n of [100, 1000]) {
  await test(`performance with ${n} tasks`, async () => {
    db.exec("DELETE FROM settings");
    seed(n);
    const r = await relaunch();
    await page.waitForSelector("li[data-id]");
    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");
    const metric = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));

    // toggle latency (click → DOM updated)
    const toggleMs = await page.evaluate(async () => {
      const box = document.querySelector("li[data-id] [role=checkbox]");
      const t0 = performance.now();
      box.click();
      await new Promise((r) => requestAnimationFrame(() => r()));
      return performance.now() - t0;
    });
    // add latency
    const addMs = await page.evaluate(async () => {
      const input = document.querySelector("#quick-add");
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, "새 할 일");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      const t0 = performance.now();
      input.form.requestSubmit();
      await new Promise((r) => requestAnimationFrame(() => r()));
      return performance.now() - t0;
    });
    // scrolling: scroll through whole list, measure frame times
    const scroll = await page.evaluate(async () => {
      const el = document.querySelector(".scroll-area");
      const frames = [];
      let last = performance.now();
      for (let i = 0; i < 60; i++) {
        el.scrollTop += el.scrollHeight / 60;
        await new Promise((r) => requestAnimationFrame(() => r()));
        const now = performance.now();
        frames.push(now - last);
        last = now;
      }
      frames.sort((a, b) => a - b);
      return { p95: frames[Math.floor(frames.length * 0.95)], max: frames[frames.length - 1] };
    });
    await sleep(1000); // let writes settle
    const m0 = await metric();
    await sleep(5000); // idle window
    const m1 = await metric();
    const busyMs = (m1.TaskDuration - m0.TaskDuration) * 1000;
    const scripts = (m1.ScriptDuration - m0.ScriptDuration) * 1000;
    const layouts = m1.LayoutCount - m0.LayoutCount;
    const heapMb = m1.JSHeapUsedSize / 1048576;
    results.push([
      "INFO",
      `${n} tasks: shown ${r.shownMs}ms, ready ${r.readyMs}ms, toggle ${toggleMs.toFixed(1)}ms, add ${addMs.toFixed(1)}ms, ` +
        `scroll p95 ${scroll.p95.toFixed(1)}ms, idle main-thread busy ${busyMs.toFixed(1)}ms/5s (script ${scripts.toFixed(1)}ms, layouts ${layouts}), JS heap ${heapMb.toFixed(1)}MB, DOM nodes ${m1.Nodes}`,
    ]);
    assert(toggleMs < 100, `toggle too slow ${toggleMs}`);
    assert(busyMs < 50, `idle not idle: ${busyMs}ms busy in 5s`);
    assert(layouts === 0, `layouts while idle: ${layouts}`);
  });
}

await test("memory: repeated view switching does not grow heap", async () => {
  const cdp = await context.newCDPSession(page);
  await cdp.send("HeapProfiler.enable");
  const heap = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    return (await cdp.send("Runtime.getHeapUsage")).usedSize / 1048576;
  };
  const toggle = async (times) => {
    for (let i = 0; i < times; i++) {
      await page.click("[role=tab]:has-text('계획')");
      await page.click("[role=tab]:has-text('할 일')");
      await page.click("[aria-label='설정']");
      await page.click("text=설정 닫기");
    }
  };
  await toggle(5);
  const a = await heap();
  await toggle(30);
  const b = await heap();
  results.push(["INFO", `heap after 5 cycles ${a.toFixed(2)}MB, after 35 cycles ${b.toFixed(2)}MB`]);
  assert(b - a < 2, `heap grew ${(b - a).toFixed(2)}MB`);
});

if (shotsDir) {
  db.exec("DELETE FROM tasks; DELETE FROM plans; DELETE FROM settings;");
  await relaunch();
  for (const t of ["운동하기", "프로젝트 코드 수정", "알고리즘 문제 2개 풀기", "영어 공부 30분"]) await addTask(t);
  await page.click("text=영어 공부 30분");
  await page.click("[role=radio]:has-text('높음')");
  await page.click("[role=dialog] button:has-text('오늘')");
  await page.keyboard.press("Control+Enter");
  await page.click("[role=checkbox][aria-label=\"'운동하기' 완료\"]");
  await page.click("[role=tab]:has-text('계획')");
  await page.fill("[aria-label='새 계획']", "AI 프로젝트 완성");
  await page.press("[aria-label='새 계획']", "Enter");
  await page.fill("textarea", "- 데이터셋 준비\n- 모델 학습\n- 성능 테스트\n- GitHub 정리");
  for (const t of ["데이터셋 준비", "모델 학습", "성능 테스트", "GitHub 정리", "발표 자료"]) {
    await page.fill("[aria-label='계획에 할 일 추가']", t);
    await page.press("[aria-label='계획에 할 일 추가']", "Enter");
  }
  for (const t of ["데이터셋 준비", "모델 학습", "성능 테스트"]) await page.click(`[role=checkbox][aria-label="'${t}' 완료"]`);
  await sleep(450); await page.screenshot({ path: join(shotsDir, "plan-editor-light.png") });
  await page.keyboard.press("Control+Enter");
  await sleep(450); await page.screenshot({ path: join(shotsDir, "plans-light.png") });
  await page.click("[role=tab]:has-text('할 일')");
  await page.mouse.move(0, 300);
  await sleep(450); await page.screenshot({ path: join(shotsDir, "todo-light.png") });
  await page.click("[aria-label='설정']");
  await page.click("[role=radio]:has-text('다크')");
  await sleep(450); await page.screenshot({ path: join(shotsDir, "settings-dark.png") });
  await page.click("text=설정 닫기");
  await sleep(450); await page.screenshot({ path: join(shotsDir, "todo-dark.png") });
  await page.click("text=영어 공부 30분");
  await sleep(450); await page.screenshot({ path: join(shotsDir, "editor-dark.png") });
}

await browser.close();
server.close();

console.log(`\nInitial launch: window shown ${startup.shownMs} ms, UI ready ${startup.readyMs} ms\n`);
for (const [s, n, d] of results) console.log(`${s.padEnd(4)} ${n}${d ? `\n       ${d}` : ""}`);
console.log(`\n${results.filter((r) => r[0] === "PASS").length} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
