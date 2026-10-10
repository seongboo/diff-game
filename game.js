// 틀린그림찾기 v0 — 정적 페이지. puzzles/index.json → puzzles/<id>/answer.json + a/b 이미지.
// 정답 좌표는 이미지 픽셀 기준(answer.json 의 width/height)이고, 화면 좌표는 비율로 환산한다.
"use strict";

const HINTS_PER_PUZZLE = 3;
const HIT_PAD_FRAC = 0.2; // 정답 박스를 짧은 변의 20%만큼 넓혀 판정 (손가락 터치 여유)
const DAILY_EPOCH = Date.UTC(2026, 0, 1);

const $ = (id) => document.getElementById(id);
const frames = [...document.querySelectorAll(".frame")];

const state = {
  list: [],
  idx: 0,
  answer: null,
  found: new Set(),
  misses: 0,
  hintsUsed: 0,
  elapsedMs: 0,
  startedAt: null,
  tick: null,
  done: false,
};

// ---------- 저장 (localStorage 는 막혀 있을 수 있으므로 실패해도 게임은 동작) ----------
const store = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 무시 */ }
  },
};
const bestKey = (id) => `diffgame:v1:best:${id}`;

// ---------- 시간 ----------
function fmt(ms) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
function elapsed() {
  return state.elapsedMs + (state.startedAt ? performance.now() - state.startedAt : 0);
}
function startTimer() {
  if (state.startedAt || state.done) return;
  state.startedAt = performance.now();
  state.tick = setInterval(() => { $("timer").textContent = fmt(elapsed()); }, 250);
}
function stopTimer() {
  state.elapsedMs = elapsed();
  state.startedAt = null;
  clearInterval(state.tick);
  state.tick = null;
}
document.addEventListener("visibilitychange", () => {
  if (!state.answer || state.done) return;
  if (document.hidden) stopTimer(); else startTimer();
});

// ---------- 퍼즐 불러오기 ----------
function dailyIndex(n) {
  // 사용자 현지 날짜 기준(한국은 자정에 바뀜). UTC 기준이면 오전 9시에 바뀐다.
  const now = new Date();
  const day = Math.floor((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - DAILY_EPOCH) / 86400000);
  return ((day % n) + n) % n;
}

function showMessage(text) {
  $("message").textContent = text;
  $("message").hidden = !text;
}

async function init() {
  try {
    const res = await fetch("puzzles/index.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status);
    state.list = (await res.json()).puzzles || [];
  } catch {
    state.list = [];
  }
  if (!state.list.length) {
    $("puzzle-title").textContent = "퍼즐이 없습니다";
    showMessage("web/puzzles/ 에 퍼즐을 생성하세요: python examples/make_demo_puzzles.py");
    setControls(false);
    return;
  }
  const fromHash = state.list.findIndex((p) => p.id === decodeURIComponent(location.hash.slice(1)));
  await load(fromHash >= 0 ? fromHash : dailyIndex(state.list.length));
}

function loadImage(img, src) {
  return new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error(`이미지를 불러오지 못했습니다: ${src}`));
    img.src = src;
  });
}

async function load(idx) {
  stopTimer();
  state.idx = idx;
  state.answer = null; // 불러오는 동안 이전 퍼즐 정답으로 판정하지 않도록
  const token = (state.loadToken = (state.loadToken || 0) + 1);
  const meta = state.list[idx];
  const base = `puzzles/${encodeURIComponent(meta.id)}/`;
  history.replaceState(null, "", `#${encodeURIComponent(meta.id)}`);
  $("puzzle-title").textContent = `퍼즐 ${idx + 1} / ${state.list.length}`;
  showMessage("");
  setControls(false);

  try {
    const res = await fetch(`${base}answer.json`, { cache: "no-cache" });
    if (!res.ok) throw new Error(`정답 파일을 불러오지 못했습니다 (${res.status})`);
    const answer = await res.json();
    const images = answer.images || { a: "a.png", b: "b.png" };
    await Promise.all([
      loadImage($("img-a"), base + images.a),
      loadImage($("img-b"), base + images.b),
    ]);
    if (token !== state.loadToken) return; // 그 사이 다른 퍼즐로 넘어감
    state.answer = answer;
  } catch (err) {
    if (token !== state.loadToken) return;
    showMessage(err.message);
    setControls(true);
    return;
  }

  state.found = new Set();
  state.misses = 0;
  state.hintsUsed = 0;
  state.elapsedMs = 0;
  state.done = false;
  frames.forEach((f) => { f.querySelector(".layer").innerHTML = ""; });

  const chip = $("difficulty");
  const labels = { easy: "쉬움", normal: "보통", hard: "어려움" };
  chip.hidden = !state.answer.difficulty;
  chip.dataset.level = state.answer.difficulty || "";
  chip.textContent = labels[state.answer.difficulty] || "";

  render();
  setControls(true);
  startTimer();
}

// ---------- 그리기 ----------
function pct(v, total) { return `${(v / total) * 100}%`; }

function addRing(diff, cls = "") {
  const { width: W, height: H } = state.answer;
  const size = Math.max(diff.w, diff.h) * 1.25;
  const els = frames.map((f) => {
    const el = document.createElement("div");
    el.className = `ring ${cls}`.trim();
    el.style.left = pct(diff.x + diff.w / 2, W);
    el.style.top = pct(diff.y + diff.h / 2, H);
    el.style.width = pct(size, W);
    f.querySelector(".layer").appendChild(el);
    return el;
  });
  return els;
}

function addCross(frame, x, y) {
  const { width: W, height: H } = state.answer;
  const el = document.createElement("div");
  el.className = "cross";
  el.textContent = "✕";
  el.style.left = pct(x, W);
  el.style.top = pct(y, H);
  frame.querySelector(".layer").appendChild(el);
  setTimeout(() => el.remove(), 700);
  frame.classList.remove("shake");
  void frame.offsetWidth; // 애니메이션 재시작
  frame.classList.add("shake");
}

function render() {
  const total = state.answer ? state.answer.differences.length : 0;
  $("found").textContent = `${state.found.size} / ${total}`;
  $("misses").textContent = String(state.misses);
  $("timer").textContent = fmt(elapsed());
  $("hints-left").textContent = String(HINTS_PER_PUZZLE - state.hintsUsed);
}

function setControls(enabled) {
  $("btn-prev").disabled = !enabled || state.list.length < 2;
  $("btn-next").disabled = !enabled || state.list.length < 2;
  $("btn-hint").disabled = !enabled || !state.answer || state.done || state.hintsUsed >= HINTS_PER_PUZZLE;
}

// ---------- 입력 ----------
function toImageCoords(frame, event) {
  const rect = frame.querySelector("img").getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * state.answer.width,
    y: ((event.clientY - rect.top) / rect.height) * state.answer.height,
  };
}

function hitTest(x, y) {
  const short = Math.min(state.answer.width, state.answer.height);
  let best = null;
  let bestDist = Infinity;
  for (const d of state.answer.differences) {
    const pad = Math.min(Math.min(d.w, d.h) * HIT_PAD_FRAC, short * 0.03) + 4;
    if (x < d.x - pad || x > d.x + d.w + pad || y < d.y - pad || y > d.y + d.h + pad) continue;
    const dist = Math.hypot(x - (d.x + d.w / 2), y - (d.y + d.h / 2));
    if (dist < bestDist) { best = d; bestDist = dist; }
  }
  return best;
}

function onPick(frame, event) {
  if (!state.answer || state.done) return;
  const { x, y } = toImageCoords(frame, event);
  const hit = hitTest(x, y);
  if (hit) {
    if (state.found.has(hit.id)) return; // 이미 찾은 곳은 실수로 치지 않음
    state.found.add(hit.id);
    frames.forEach((f) => f.querySelectorAll(".ring.hint").forEach((el) => el.remove()));
    addRing(hit);
    if (state.found.size === state.answer.differences.length) finish();
  } else {
    state.misses += 1;
    addCross(frame, x, y);
  }
  render();
}

frames.forEach((frame) => {
  frame.addEventListener("click", (e) => onPick(frame, e));
});

$("btn-hint").addEventListener("click", () => {
  if (!state.answer || state.done || state.hintsUsed >= HINTS_PER_PUZZLE) return;
  const next = state.answer.differences.find((d) => !state.found.has(d.id));
  if (!next) return;
  state.hintsUsed += 1;
  const rings = addRing(next, "hint");
  setTimeout(() => rings.forEach((el) => el.remove()), 2500);
  render();
  setControls(true);
});

const step = (delta) => load((state.idx + delta + state.list.length) % state.list.length);
$("btn-prev").addEventListener("click", () => step(-1));
$("btn-next").addEventListener("click", () => step(1));

// ---------- 완료 ----------
function starsFor(misses, hints) {
  if (misses <= 1 && hints === 0) return 3;
  if (misses <= 4 && hints <= 1) return 2;
  return 1;
}

function finish() {
  stopTimer();
  state.done = true;
  setControls(true);
  const id = state.list[state.idx].id;
  const ms = state.elapsedMs;
  const stars = starsFor(state.misses, state.hintsUsed);

  const prev = store.get(bestKey(id));
  const isBest = !prev || stars > prev.stars || (stars === prev.stars && ms < prev.ms);
  if (isBest) store.set(bestKey(id), { ms, stars });
  const best = isBest ? { ms, stars } : prev;

  $("done-stars").textContent = "★".repeat(stars) + "☆".repeat(3 - stars);
  $("done-stars").setAttribute("aria-label", `별 ${stars}개`);
  $("done-time").textContent = fmt(ms);
  $("done-misses").textContent = String(state.misses);
  $("done-hints").textContent = String(state.hintsUsed);
  $("done-best").textContent = isBest && prev ? `${fmt(best.ms)} (신기록)` : fmt(best.ms);
  setTimeout(() => $("done").showModal(), 450);
}

$("btn-retry").addEventListener("click", () => { $("done").close(); load(state.idx); });
$("btn-done-next").addEventListener("click", () => { $("done").close(); step(1); });

init();
