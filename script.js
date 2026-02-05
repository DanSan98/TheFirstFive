// ====== CONFIG ======
const CONFIG = {
  password: "five",
  testUnlockAll: true, // ✅ set to true to preview unlocked; set back to false before final

  albumTitle: "THE FIRST FIVE",
  artistName: "DanSan",
  year: 2026,

  // Unlock schedule (local midnight):
  unlockDates: [
    { year: 2026, month: 2, day: 6 },
    { year: 2026, month: 2, day: 8 },
    { year: 2026, month: 2, day: 10 },
    { year: 2026, month: 2, day: 12 },
    { year: 2026, month: 2, day: 14 },
  ],

  // Keep numeric filenames to avoid spoilers
  tracks: [
  { revealedName: "I Got You — Jack Johnson", file: "songs/01.mp3" },
  { revealedName: "Until I Found You — Stephen Sanchez", file: "songs/02.mp3" },
  { revealedName: "Light My Love (Piano Version) — Greta Van Fleet", file: "songs/03.mp3" },
  { revealedName: "Smithereens (Acoustic Version) — Twenty One Pilots", file: "songs/04.mp3" },
  { revealedName: "My Valentine — Paul McCartney", file: "songs/05.mp3" },
],

  albumMessage:
    "Five songs. The final track unlocks on Feb 14 ❤️",

  hiddenTitlePrefix: "Track",
  hiddenTitleSuffix: "— Locked",
};
// =====================

const $ = (sel) => document.querySelector(sel);
window.onerror = (msg, src, line, col, err) => {
  const e = document.getElementById("err");
  if (e) {
    e.style.display = "block";
    e.textContent = `JS ERROR:\n${msg}\n${src}:${line}:${col}\n${err?.stack || ""}`;
  }
};
const durationCache = new Map(); // file -> "m:ss"
const durationPending = new Set(); // files currently probing duration
let albumQueue = [];             // unlocked tracks in order
let currentAlbumIndex = -1;
let currentAlbumAudio = null;

function pad2(n){ return String(n).padStart(2, "0"); }

function formatCountdown(ms){
  if (ms <= 0) return "Unlocked";
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / (3600 * 24));
  const hours = Math.floor((totalSeconds % (3600 * 24)) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${pad2(hours)}h ${pad2(minutes)}m ${pad2(seconds)}s`;
  return `${pad2(hours)}h ${pad2(minutes)}m ${pad2(seconds)}s`;
}

function formatDuration(seconds){
  if (!Number.isFinite(seconds) || seconds <= 0) return "—:—";
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${pad2(r)}`;
}

function localMidnightDate(y, m, d){
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function getUnlockDateForTrack(index){
  const d = CONFIG.unlockDates[index];
  // Safety: if date missing, unlock far in the future (keeps it locked, avoids crash)
  if (!d) return new Date(2999, 0, 1);
  return localMidnightDate(d.year, d.month, d.day);
}

function isUnlocked(unlockDate, now){
  if (CONFIG.testUnlockAll) return true;   // TEST: everything unlocked
  return now >= unlockDate;               // REAL behavior
}

function findNextUnlock(now){
  for (let i = 0; i < CONFIG.tracks.length; i++){
    const d = getUnlockDateForTrack(i);
    if (!isUnlocked(d, now)) return { index: i, date: d };
  }
  return null;
}

function stopAllAudioExcept(currentAudio){
  document.querySelectorAll("audio").forEach(a => {
    if (a !== currentAudio) a.pause();
  });
}

// Metadata probe (once) to get duration
function ensureDurationLoaded(file, cb){
  if (durationCache.has(file)) { cb(); return; }
  if (durationPending.has(file)) { return; } // already loading
  durationPending.add(file);

  const probe = new Audio();
  probe.preload = "metadata";
  probe.src = file;

  const done = () => {
    durationPending.delete(file);
    probe.removeEventListener("loadedmetadata", onMeta);
    probe.removeEventListener("error", onErr);
    cb();
  };

  const onMeta = () => { durationCache.set(file, formatDuration(probe.duration)); done(); };
  const onErr  = () => { durationCache.set(file, "—:—"); done(); };

  probe.addEventListener("loadedmetadata", onMeta);
  probe.addEventListener("error", onErr);
}

// Build albumQueue of unlocked tracks
function rebuildAlbumQueue(){
  const now = new Date();
  albumQueue = CONFIG.tracks
    .map((t, i) => ({ ...t, index: i, unlockDate: getUnlockDateForTrack(i) }))
    .filter(x => isUnlocked(x.unlockDate, now));
}

// Play album from first unlocked (or continue)
function playAlbum(){
  rebuildAlbumQueue();
  if (albumQueue.length === 0) {
    alert("No tracks unlocked yet.");
    return;
  }

  // If nothing playing, start from 0
  if (currentAlbumIndex < 0 || currentAlbumIndex >= albumQueue.length) {
    currentAlbumIndex = 0;
  }

  const target = albumQueue[currentAlbumIndex];
  const audioEl = document.querySelector(`audio[data-file="${target.file}"]`);

  if (!audioEl) {
    // audio elements might not exist if render is behind; re-render and try again
    render();
    setTimeout(playAlbum, 150);
    return;
  }

  stopAllAudioExcept(audioEl);
  currentAlbumAudio = audioEl;
  audioEl.play().catch(() => {});
}

function pauseAlbum(){
  if (currentAlbumAudio) currentAlbumAudio.pause();
}

// When a track ends, go next in albumQueue
function attachAlbumEndHandler(audioEl){
  audioEl.addEventListener("ended", () => {
    rebuildAlbumQueue();
    if (albumQueue.length === 0) return;

    // Find current file in queue
    const idx = albumQueue.findIndex(x => x.file === audioEl.dataset.file);
    if (idx === -1) return;

    const nextIndex = idx + 1;
    if (nextIndex >= albumQueue.length) {
      // End of unlocked album
      currentAlbumIndex = -1;
      currentAlbumAudio = null;
      return;
    }

    currentAlbumIndex = nextIndex;
    playAlbum();
  });
}

// PASSWORD GATE
function initGate(){
  const gate = $("#gate");
  const app = $("#app");
  const pw = $("#pw");
  const btn = $("#pwBtn");
  const hint = $("#pwHint");

  // Allow staying unlocked on the same device
  const stored = localStorage.getItem("ds_album_ok");
  if (stored === "1") {
    gate.style.display = "none";
    app.classList.remove("hidden");
    initApp();
    return;
  }

  const attempt = () => {
    if ((pw.value || "").trim().toLowerCase() === CONFIG.password) {
      localStorage.setItem("ds_album_ok", "1");
      gate.style.display = "none";
      app.classList.remove("hidden");
      initApp();
    } else {
      hint.textContent = "Wrong password.";
      pw.value = "";
      pw.focus();
    }
  };

  btn.addEventListener("click", attempt);
  pw.addEventListener("keydown", (e) => {
    if (e.key === "Enter") attempt();
  });
}

function initApp(){
  // Buttons
  $("#playAlbumBtn").addEventListener("click", playAlbum);
  $("#pauseAlbumBtn").addEventListener("click", pauseAlbum);

  // Slight Spotify vibe: use cover as bg glow
  const cover = $("#coverImg");
  cover.addEventListener("load", () => {
    // We keep it simple; CSS already has glow.
  });

  render();
setInterval(updateCountdownOnly, 1000);
}

function render(){
  $("#albumTitle").textContent = CONFIG.albumTitle;
  $("#artistName").textContent = CONFIG.artistName;
  $("#yearLabel").textContent = String(CONFIG.year);
  $("#trackCountLabel").textContent = `${CONFIG.tracks.length} songs`;
  $("#albumMessage").textContent = CONFIG.albumMessage;

    const tracksWrap = $("#tracks");
  if (!tracksWrap) {
    console.error("Tracks container not found");
    return;
  }
  tracksWrap.innerHTML = "";

  const now = new Date();

  CONFIG.tracks.forEach((t, i) => {
    const unlockDate = getUnlockDateForTrack(i);
    const unlocked = isUnlocked(unlockDate, now);

    const shownTitle = unlocked
  ? t.revealedName
  : `${CONFIG.hiddenTitlePrefix} ${i + 1} ${CONFIG.hiddenTitleSuffix}`;


    const unlockLabel = unlocked
      ? "Unlocked"
      : `Unlocks: ${unlockDate.toLocaleDateString(undefined, { month:"short", day:"numeric" })} — ${formatCountdown(unlockDate.getTime() - now.getTime())}`;

    const shownDuration = unlocked ? (durationCache.get(t.file) ?? "…") : "";

    const row = document.createElement("div");
    row.className = "row" + (unlocked ? "" : " locked");

    row.innerHTML = `
  <div class="num">
  <span class="num-text">${i + 1}</span>
  <button class="play-icon hidden" aria-label="Play">▶</button>
</div>
  <div class="track-title">
    <div class="name">${shownTitle}</div>
    <div class="unlock">${unlockLabel}</div>
    <div class="seek hidden">
      <span class="tcur">0:00</span>
      <input class="bar" type="range" min="0" max="1000" value="0" step="1" />
      <span class="tdur">${shownDuration || "—:—"}</span>
    </div>
  </div>
  <div class="dur">${shownDuration}</div>
  <div class="actions"></div>
`;

    const actions = row.querySelector(".actions");

    if (unlocked){

      const audio = document.createElement("audio");
      audio.className = "audio";
      audio.controls = false; // no native UI = no 3 dots
      audio.preload = "metadata";
      audio.src = t.file;
      audio.dataset.file = t.file;
      audio.addEventListener("error", () => {
  alert(`Audio failed to load: ${t.file}\nCheck the filename and that Live Server is running.`);
});

// --- Seek UI wiring ---
const seekWrap = row.querySelector(".seek");
const bar = row.querySelector(".bar");
const tcur = row.querySelector(".tcur");
const tdur = row.querySelector(".tdur");

// show seek UI for unlocked tracks
seekWrap.classList.remove("hidden");

function fmtTime(sec){
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// when metadata loads, set duration label
audio.addEventListener("loadedmetadata", () => {
  tdur.textContent = fmtTime(audio.duration);
});

// update bar as song plays
audio.addEventListener("timeupdate", () => {
  if (!audio.duration) return;
  const v = Math.round((audio.currentTime / audio.duration) * 1000);
  bar.value = String(v);
  tcur.textContent = fmtTime(audio.currentTime);
});

// allow scrubbing
bar.addEventListener("input", () => {
  if (!audio.duration) return;
  const pct = Number(bar.value) / 1000;
  audio.currentTime = pct * audio.duration;
});



      audio.addEventListener("play", () => stopAllAudioExcept(audio));
      attachAlbumEndHandler(audio);

      actions.appendChild(audio);

      const playIcon = row.querySelector(".play-icon");
const numText = row.querySelector(".num-text");

playIcon.classList.remove("hidden");
numText.classList.add("hidden");

playIcon.addEventListener("click", async () => {
  try {
    stopAllAudioExcept(audio);
    currentAlbumAudio = audio;

    if (!audio.paused) {
      audio.pause();
      playIcon.textContent = "▶";
      return;
    }

    await audio.play();
    playIcon.textContent = "⏸";
  } catch {
    alert("Could not play audio.");
  }
});

audio.addEventListener("pause", () => playIcon.textContent = "▶");
audio.addEventListener("play",  () => playIcon.textContent = "⏸");

      // Load duration metadata and re-render to show duration
      ensureDurationLoaded(t.file, () => {
  // Update only if the row is still on screen (avoid recursion storms)
  const durCell = row.querySelector(".dur");
  if (durCell) durCell.textContent = durationCache.get(t.file) ?? "—:—";
});
    } else {
      const lock = document.createElement("div");
      lock.className = "lock-icon";
      lock.textContent = "🔒 Locked";
      actions.appendChild(lock);
    }

    tracksWrap.appendChild(row);
  });
}
function updateCountdownOnly(){
  const now = new Date();
  const next = findNextUnlock(now);

  if (!next){
    $("#globalCountdown").textContent = "All songs unlocked ❤️";
  } else {
    const ms = next.date.getTime() - now.getTime();
    const dStr = next.date.toLocaleDateString(undefined, { month:"short", day:"numeric" });
    $("#globalCountdown").textContent =
      `Next unlock: Track ${next.index + 1} • ${dStr} • ${formatCountdown(ms)}`;
  }
}
// START
initGate();
// Debug: confirm app init
console.log("Gate initialized");