(function () {
  "use strict";

  const STORE = "focus_portable_v1";
  const TIMER_STORE = "focus_portable_timer_v1";
  const SETTINGS_STORE = "focus_pomodoro_settings_v1";
  const IMPORT_KEYS = ["focus_portable_v1", "focus_simple_v3", "focus_simple_v2"];
  const QUICK_DURATIONS = [25, 50, 90];
  const MODES = ["focus", "shortBreak", "longBreak"];

  const $ = (id) => document.getElementById(id);
  const clamp = (value, min, max, fallback) => {
    const number = Math.round(Number(value));
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  };

  function localDate(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function emptyState() {
    return { version: 5, tasks: [], selected: null, history: {}, vault: "brain", lastObsidianUri: "" };
  }

  function normalizeState(raw) {
    const next = emptyState();
    if (!raw || !Array.isArray(raw.tasks)) return next;
    next.tasks = raw.tasks.map((task, index) => ({
      id: Number(task.id) || Date.now() + index,
      name: String(task.name || "名称なし").slice(0, 80),
      focus: Math.max(0, Number(task.focus) || 0),
      done: Boolean(task.done),
      createdAt: Number(task.createdAt || task.id) || Date.now() + index,
    }));
    next.selected = next.tasks.some((task) => task.id === Number(raw.selected)) ? Number(raw.selected) : null;
    next.history = raw.history && typeof raw.history === "object" ? raw.history : {};
    next.vault = String(raw.vault || "brain").slice(0, 80);
    next.lastObsidianUri = String(raw.lastObsidianUri || "");
    return next;
  }

  function loadState() {
    for (const key of IMPORT_KEYS) {
      try {
        const parsed = JSON.parse(localStorage.getItem(key) || "null");
        if (parsed && Array.isArray(parsed.tasks)) return normalizeState(parsed);
      } catch (_) {}
    }
    return emptyState();
  }

  function defaultSettings() {
    return {
      focusMinutes: 25,
      shortBreakMinutes: 5,
      longBreakMinutes: 15,
      longBreakInterval: 4,
      autoStartFocus: false,
      autoStartBreak: false,
      skipBreak: false,
      volume: 65,
      focusEndSound: "bell",
      breakEndSound: "timer",
      nearEndNotification: false,
      vibration: 0,
      whiteNoise: "none",
    };
  }

  function normalizeSettings(raw) {
    const base = defaultSettings();
    if (!raw || typeof raw !== "object") return base;
    const soundNames = ["none", "bell", "timer", "soft"];
    const noises = ["none", "ticktock", "seconds", "cricket", "classroom", "mountain", "stream", "beach", "rain", "cafe", "fire", "library", "wind", "frogs"];
    return {
      focusMinutes: clamp(raw.focusMinutes, 1, 120, base.focusMinutes),
      shortBreakMinutes: clamp(raw.shortBreakMinutes, 1, 60, base.shortBreakMinutes),
      longBreakMinutes: clamp(raw.longBreakMinutes, 1, 90, base.longBreakMinutes),
      longBreakInterval: clamp(raw.longBreakInterval, 1, 10, base.longBreakInterval),
      autoStartFocus: Boolean(raw.autoStartFocus),
      autoStartBreak: Boolean(raw.autoStartBreak),
      skipBreak: Boolean(raw.skipBreak),
      volume: clamp(raw.volume, 0, 100, base.volume),
      focusEndSound: soundNames.includes(raw.focusEndSound) ? raw.focusEndSound : base.focusEndSound,
      breakEndSound: soundNames.includes(raw.breakEndSound) ? raw.breakEndSound : base.breakEndSound,
      nearEndNotification: Boolean(raw.nearEndNotification),
      vibration: [0, 1, 3].includes(Number(raw.vibration)) ? Number(raw.vibration) : 0,
      whiteNoise: noises.includes(raw.whiteNoise) ? raw.whiteNoise : base.whiteNoise,
    };
  }

  function loadSettings() {
    try {
      return normalizeSettings(JSON.parse(localStorage.getItem(SETTINGS_STORE) || "null"));
    } catch (_) {
      return defaultSettings();
    }
  }

  function durationForMode(mode) {
    if (mode === "shortBreak") return settings.shortBreakMinutes;
    if (mode === "longBreak") return settings.longBreakMinutes;
    return settings.focusMinutes;
  }

  function emptyTimer() {
    return { mode: "focus", duration: settings.focusMinutes, remaining: settings.focusMinutes * 60, startedAt: null, endAt: null, running: false, focusCount: 0, nearEndNotified: false };
  }

  function loadTimer() {
    try {
      const saved = JSON.parse(localStorage.getItem(TIMER_STORE) || "null");
      if (!saved) return emptyTimer();
      const mode = MODES.includes(saved.mode) ? saved.mode : "focus";
      const duration = clamp(saved.duration, 1, 120, durationForMode(mode));
      return {
        mode,
        duration,
        remaining: Math.max(0, Number(saved.remaining) || duration * 60),
        startedAt: Number(saved.startedAt) || null,
        endAt: Number(saved.endAt) || null,
        running: Boolean(saved.running),
        focusCount: Math.max(0, Number(saved.focusCount) || 0),
        nearEndNotified: Boolean(saved.nearEndNotified),
      };
    } catch (_) {
      return emptyTimer();
    }
  }

  let settings = loadSettings();
  let data = loadState();
  let timerState = loadTimer();
  let tickHandle = null;
  let viewMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let selectedDay = localDate();
  let audioContext = null;
  let noiseSource = null;
  let noiseFilter = null;
  let noiseGain = null;
  let noiseTimers = [];
  let previewingNoise = false;

  function save() {
    localStorage.setItem(STORE, JSON.stringify(data));
  }

  function saveTimer() {
    localStorage.setItem(TIMER_STORE, JSON.stringify(timerState));
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_STORE, JSON.stringify(settings));
  }

  function recordsFor(key) {
    return Array.isArray(data.history[key]) ? data.history[key] : [];
  }

  function minutesFor(key) {
    return recordsFor(key).reduce((sum, item) => sum + (Number(item.minutes) || 0), 0);
  }

  function selectedTask() {
    return data.tasks.find((task) => task.id === data.selected) || null;
  }

  function formatClock(total) {
    const seconds = Math.max(0, Math.ceil(total));
    return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function currentRemaining() {
    if (timerState.running && timerState.endAt) return Math.max(0, Math.ceil((timerState.endAt - Date.now()) / 1000));
    return Math.max(0, timerState.remaining);
  }

  function ensureAudio() {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return null;
    if (!audioContext) audioContext = new AudioCtor();
    if (audioContext.state === "suspended") audioContext.resume().catch(() => undefined);
    return audioContext;
  }

  function tone(frequency, delay, duration, gain = 0.14, type = "sine") {
    const context = ensureAudio();
    if (!context || settings.volume <= 0) return;
    const oscillator = context.createOscillator();
    const volume = context.createGain();
    const start = context.currentTime + delay;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    volume.gain.setValueAtTime(0.0001, start);
    volume.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain * settings.volume / 100), start + 0.015);
    volume.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(volume).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
  }

  function playSound(name) {
    if (name === "none") return;
    if (name === "timer") {
      tone(880, 0, 0.14, 0.18, "square");
      tone(880, 0.23, 0.14, 0.18, "square");
      tone(1046, 0.46, 0.3, 0.16, "square");
    } else if (name === "soft") {
      tone(523, 0, 0.45, 0.13);
      tone(659, 0.16, 0.5, 0.11);
      tone(784, 0.32, 0.65, 0.1);
    } else {
      tone(659, 0, 0.55, 0.16);
      tone(988, 0.18, 0.75, 0.13);
    }
  }

  function vibrate() {
    if (settings.vibration > 0 && typeof navigator.vibrate === "function") navigator.vibrate(settings.vibration * 1000);
  }

  function makeNoiseBuffer(context, color) {
    const length = context.sampleRate * 4;
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const output = buffer.getChannelData(0);
    let brown = 0;
    let b0 = 0; let b1 = 0; let b2 = 0; let b3 = 0; let b4 = 0; let b5 = 0; let b6 = 0;
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      if (color === "brown") {
        brown = (brown + 0.02 * white) / 1.02;
        output[i] = brown * 3.2;
      } else if (color === "pink") {
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.969 * b2 + white * 0.153852;
        b3 = 0.8665 * b3 + white * 0.3104856;
        b4 = 0.55 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.016898;
        output[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
      } else output[i] = white * 0.55;
    }
    return buffer;
  }

  function ambientPulse(kind) {
    if (kind === "ticktock" || kind === "seconds") {
      tone(kind === "ticktock" ? 1150 : 760, 0, 0.045, 0.045, "square");
      return;
    }
    if (kind === "cricket" || kind === "frogs") {
      const base = kind === "cricket" ? 3200 : 260;
      tone(base, 0, 0.09, 0.035, "sine");
      tone(base * 1.08, 0.12, 0.08, 0.028, "sine");
      return;
    }
    if (kind === "fire") tone(160 + Math.random() * 140, 0, 0.035, 0.025, "triangle");
  }

  function stopNoise() {
    noiseTimers.forEach((timer) => window.clearInterval(timer));
    noiseTimers = [];
    if (noiseSource) {
      try { noiseSource.stop(); } catch (_) {}
      noiseSource.disconnect();
    }
    if (noiseFilter) noiseFilter.disconnect();
    if (noiseGain) noiseGain.disconnect();
    noiseSource = null;
    noiseFilter = null;
    noiseGain = null;
  }

  function startNoise(preview = false) {
    stopNoise();
    previewingNoise = preview;
    const kind = settings.whiteNoise;
    if (kind === "none") return;
    const context = ensureAudio();
    if (!context) return;
    if (["ticktock", "seconds"].includes(kind)) {
      ambientPulse(kind);
      noiseTimers.push(window.setInterval(() => ambientPulse(kind), 1000));
      return;
    }
    const color = ["mountain", "beach", "fire", "wind", "frogs"].includes(kind) ? "brown" : ["classroom", "cafe", "library", "cricket"].includes(kind) ? "pink" : "white";
    noiseSource = context.createBufferSource();
    noiseSource.buffer = makeNoiseBuffer(context, color);
    noiseSource.loop = true;
    noiseFilter = context.createBiquadFilter();
    noiseGain = context.createGain();
    const filterType = ["rain", "stream"].includes(kind) ? "highpass" : ["beach", "mountain", "wind", "fire", "frogs"].includes(kind) ? "lowpass" : "bandpass";
    noiseFilter.type = filterType;
    noiseFilter.frequency.value = kind === "rain" ? 900 : kind === "stream" ? 420 : kind === "cafe" ? 700 : 360;
    noiseFilter.Q.value = filterType === "bandpass" ? 0.35 : 0.7;
    const baseGain = ["cafe", "classroom", "library"].includes(kind) ? 0.08 : 0.13;
    noiseGain.gain.value = baseGain * settings.volume / 100;
    noiseSource.connect(noiseFilter).connect(noiseGain).connect(context.destination);
    noiseSource.start();
    if (["cricket", "frogs", "fire"].includes(kind)) {
      ambientPulse(kind);
      const delay = kind === "fire" ? 850 : kind === "cricket" ? 2400 : 3600;
      noiseTimers.push(window.setInterval(() => ambientPulse(kind), delay));
    }
  }

  function syncNoise() {
    if (timerState.running || previewingNoise) startNoise(previewingNoise);
    else stopNoise();
  }

  async function sendNotification(title, body) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    try {
      if ("serviceWorker" in navigator) {
        const registration = await navigator.serviceWorker.ready;
        await registration.showNotification(title, { body, icon: "./icon-192.png", badge: "./icon-192.png", tag: "focus-timer" });
      } else new Notification(title, { body });
    } catch (_) {}
  }

  async function requestNotificationPermission() {
    if (!("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    try { return (await Notification.requestPermission()) === "granted"; } catch (_) { return false; }
  }

  function makeObsidianUri(task, minutes, now) {
    const key = localDate(now);
    const time = now.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", hour12: false });
    const content = `\n- ${time}｜${task.name}｜${minutes}分`;
    return `obsidian://new?vault=${encodeURIComponent(data.vault)}&file=${encodeURIComponent(`Focus/${key}`)}&content=${encodeURIComponent(content)}&append&silent`;
  }

  function setMode(mode, autoStart = false) {
    const duration = durationForMode(mode);
    timerState = { mode, duration, remaining: duration * 60, startedAt: null, endAt: null, running: false, focusCount: timerState.focusCount, nearEndNotified: false };
    saveTimer();
    stopNoise();
    if (autoStart) startTimer();
  }

  function recordFocus(openObsidian) {
    const task = selectedTask();
    if (!task) {
      $("task-input").focus();
      $("sync-text").textContent = "先にタスクを追加して選んでください";
      return;
    }
    const now = new Date();
    const elapsedSeconds = Math.max(0, timerState.duration * 60 - currentRemaining());
    const minutes = Math.min(timerState.duration, Math.max(1, Math.round(elapsedSeconds / 60) || timerState.duration));
    const key = localDate(now);
    const time = now.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", hour12: false });
    const uri = makeObsidianUri(task, minutes, now);
    data.tasks = data.tasks.map((item) => item.id === task.id ? { ...item, focus: item.focus + minutes, done: true } : item);
    data.history[key] = [...recordsFor(key), { id: now.getTime(), taskId: task.id, taskName: task.name, minutes, time }];
    data.lastObsidianUri = uri;
    save();
    timerState.focusCount += 1;
    playSound(settings.focusEndSound);
    vibrate();
    const longBreak = timerState.focusCount % settings.longBreakInterval === 0;
    const nextMode = settings.skipBreak ? "focus" : longBreak ? "longBreak" : "shortBreak";
    setMode(nextMode, settings.skipBreak ? settings.autoStartFocus : settings.autoStartBreak);
    selectedDay = key;
    viewMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextLabel = settings.skipBreak ? "次の集中" : longBreak ? `${settings.longBreakMinutes}分の長い休憩` : `${settings.shortBreakMinutes}分の休憩`;
    $("sync-text").textContent = `集中を記録しました。次は${nextLabel}です`;
    render();
    if (openObsidian) window.location.href = uri;
  }

  function finishBreak() {
    playSound(settings.breakEndSound);
    vibrate();
    setMode("focus", settings.autoStartFocus);
    $("sync-text").textContent = "休憩が終わりました。次の集中を始めましょう";
    render();
  }

  function complete(openObsidian) {
    stopNoise();
    if (timerState.mode === "focus") recordFocus(openObsidian);
    else finishBreak();
  }

  function setDuration(minutes) {
    if (timerState.running || timerState.mode !== "focus") return;
    settings.focusMinutes = minutes;
    saveSettings();
    timerState = { ...timerState, duration: minutes, remaining: minutes * 60, startedAt: null, endAt: null, nearEndNotified: false };
    saveTimer();
    renderSettings();
    renderTimer();
  }

  function startTimer() {
    if (timerState.mode === "focus" && !selectedTask()) {
      $("task-input").focus();
      $("sync-text").textContent = "先にタスクを追加して選んでください";
      return false;
    }
    ensureAudio();
    if (timerState.remaining <= 0) timerState.remaining = timerState.duration * 60;
    if (!timerState.startedAt) timerState.startedAt = Date.now();
    timerState.endAt = Date.now() + timerState.remaining * 1000;
    timerState.running = true;
    saveTimer();
    startNoise(false);
    return true;
  }

  function toggleTimer() {
    if (timerState.running) {
      timerState.remaining = currentRemaining();
      timerState.running = false;
      timerState.endAt = null;
      stopNoise();
    } else startTimer();
    saveTimer();
    renderTimer();
  }

  function modeLabel(mode) {
    return mode === "shortBreak" ? "短い休憩" : mode === "longBreak" ? "長い休憩" : "集中";
  }

  function renderTimer() {
    const remaining = currentRemaining();
    $("timer").textContent = formatClock(remaining);
    $("timer-mode").textContent = modeLabel(timerState.mode);
    $("pomodoro-count").textContent = `${timerState.focusCount % settings.longBreakInterval} / ${settings.longBreakInterval} ポモドーロ`;
    $("current-task").textContent = timerState.mode === "focus" ? selectedTask()?.name || "タスクを選んでください" : timerState.mode === "longBreak" ? "ゆっくり休みましょう" : "少し休みましょう";
    $("start-button").textContent = timerState.running ? "一時停止" : timerState.startedAt ? "再開" : timerState.mode === "focus" ? "集中開始" : "休憩開始";
    $("complete-button").textContent = timerState.mode === "focus" ? "完了して記録" : "休憩を終了";
    $("timer").closest(".timer-card").classList.toggle("is-break", timerState.mode !== "focus");
    if (timerState.mode === "focus") {
      $("duration-chips").replaceChildren(...QUICK_DURATIONS.map((minutes) => {
        const button = document.createElement("button");
        button.className = `chip${timerState.duration === minutes ? " active" : ""}`;
        button.textContent = `${minutes}分`;
        button.disabled = timerState.running;
        button.addEventListener("click", () => setDuration(minutes));
        return button;
      }));
    } else {
      const chip = document.createElement("button");
      chip.className = "chip active";
      chip.disabled = true;
      chip.textContent = `${modeLabel(timerState.mode)} ${timerState.duration}分`;
      $("duration-chips").replaceChildren(chip);
    }
  }

  function renderTasks() {
    const list = $("task-list");
    list.replaceChildren();
    if (!data.tasks.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "タスクを追加すると、ここに順番に並びます。";
      list.append(empty);
    }
    data.tasks.forEach((task, index) => {
      const row = document.createElement("div");
      row.className = `task${data.selected === task.id ? " selected" : ""}`;
      const order = document.createElement("span");
      order.className = "order";
      order.textContent = String(index + 1);
      const name = document.createElement("button");
      name.className = `task-name${task.done ? " done" : ""}`;
      name.textContent = task.name;
      name.addEventListener("click", () => { data.selected = task.id; save(); render(); });
      const time = document.createElement("span");
      time.className = "task-time";
      time.textContent = `${task.focus}分`;
      const remove = document.createElement("button");
      remove.className = "delete";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `${task.name}を削除`);
      remove.addEventListener("click", () => {
        if (!window.confirm(`「${task.name}」を一覧から削除しますか？\n記録済みの履歴は残ります。`)) return;
        data.tasks = data.tasks.filter((item) => item.id !== task.id);
        if (data.selected === task.id) data.selected = null;
        save();
        render();
      });
      row.append(order, name, time, remove);
      list.append(row);
    });
    $("active-count").textContent = `未完了 ${data.tasks.filter((task) => !task.done).length}件`;
    const table = $("task-table");
    if (!data.tasks.length) {
      table.innerHTML = '<div class="empty">タスクはまだありません。</div>';
      return;
    }
    const wrapper = document.createElement("div");
    wrapper.className = "table-wrap";
    const el = document.createElement("table");
    el.innerHTML = "<thead><tr><th>順</th><th>タスク名</th><th>累計</th><th>状態</th></tr></thead>";
    const body = document.createElement("tbody");
    data.tasks.forEach((task, index) => {
      const row = document.createElement("tr");
      const cells = [String(index + 1), task.name, `${task.focus}分`, task.done ? "完了" : "未完了"];
      cells.forEach((value, cellIndex) => {
        const cell = document.createElement("td");
        if (cellIndex === 1 && task.done) cell.className = "done";
        if (cellIndex === 3) {
          const status = document.createElement("span");
          status.className = `status${task.done ? " completed" : ""}`;
          status.textContent = value;
          cell.append(status);
        } else cell.textContent = value;
        row.append(cell);
      });
      body.append(row);
    });
    el.append(body);
    wrapper.append(el);
    table.replaceChildren(wrapper);
  }

  function renderCalendar() {
    const y = viewMonth.getFullYear();
    const m = viewMonth.getMonth();
    $("month-label").textContent = `${y}年 ${m + 1}月`;
    const first = new Date(y, m, 1).getDay();
    const last = new Date(y, m + 1, 0).getDate();
    const length = Math.ceil((first + last) / 7) * 7;
    const calendar = $("calendar");
    calendar.replaceChildren();
    for (let index = 0; index < length; index += 1) {
      const day = index - first + 1;
      if (day < 1 || day > last) {
        const blank = document.createElement("span");
        blank.className = "day blank";
        calendar.append(blank);
        continue;
      }
      const date = new Date(y, m, day);
      const key = localDate(date);
      const minutes = minutesFor(key);
      const button = document.createElement("button");
      button.className = `day${minutes ? " has" : ""}${key === localDate() ? " is-today" : ""}${key === selectedDay ? " is-selected" : ""}`;
      button.setAttribute("aria-label", `${m + 1}月${day}日 ${minutes}分`);
      button.innerHTML = `<span>${day}</span><small>${minutes ? `${minutes}分` : " "}</small>`;
      button.addEventListener("click", () => { selectedDay = key; renderCalendar(); });
      calendar.append(button);
    }
    const details = $("day-details");
    details.replaceChildren();
    const heading = document.createElement("h3");
    heading.textContent = `${new Intl.DateTimeFormat("ja-JP", { month: "long", day: "numeric", weekday: "short" }).format(new Date(`${selectedDay}T00:00:00`))}の内訳`;
    details.append(heading);
    const records = recordsFor(selectedDay);
    if (!records.length) {
      const empty = document.createElement("div");
      empty.className = "empty compact";
      empty.textContent = "この日の記録はありません。";
      details.append(empty);
    } else {
      records.forEach((item) => {
        const row = document.createElement("div");
        row.className = "record";
        const info = document.createElement("div");
        const name = document.createElement("strong");
        name.textContent = String(item.taskName || "名称なし");
        const time = document.createElement("small");
        time.textContent = String(item.time || "");
        info.append(name, time);
        const minutes = document.createElement("b");
        minutes.textContent = `${Number(item.minutes) || 0}分`;
        row.append(info, minutes);
        details.append(row);
      });
      const total = document.createElement("div");
      total.className = "total";
      total.innerHTML = `<span>合計</span><strong>${minutesFor(selectedDay)}分</strong>`;
      details.append(total);
    }
  }

  function renderStats() {
    const records = recordsFor(localDate());
    $("today-minutes").textContent = `${minutesFor(localDate())}分`;
    $("today-tasks").textContent = `${new Set(records.map((item) => item.taskId ?? item.taskName)).size}件`;
  }

  function renderObsidian() {
    $("vault").value = data.vault;
    $("vault-label").textContent = data.vault;
    $("open-obsidian").href = `obsidian://open?vault=${encodeURIComponent(data.vault)}`;
    const retry = $("retry-obsidian");
    retry.href = data.lastObsidianUri || "#";
    retry.classList.toggle("hidden", !data.lastObsidianUri);
  }

  function fillNumberSelect(id, min, max, suffix) {
    const select = $(id);
    if (select.options.length) return;
    for (let number = min; number <= max; number += 1) {
      const option = document.createElement("option");
      option.value = String(number);
      option.textContent = `${number}${suffix}`;
      select.append(option);
    }
  }

  function renderSettings() {
    $("setting-focus-minutes").value = String(settings.focusMinutes);
    $("setting-short-break").value = String(settings.shortBreakMinutes);
    $("setting-long-break").value = String(settings.longBreakMinutes);
    $("setting-long-interval").value = String(settings.longBreakInterval);
    $("setting-auto-focus").checked = settings.autoStartFocus;
    $("setting-auto-break").checked = settings.autoStartBreak;
    $("setting-skip-break").checked = settings.skipBreak;
    $("setting-volume").value = String(settings.volume);
    $("volume-value").textContent = `${settings.volume}%`;
    $("setting-focus-sound").value = settings.focusEndSound;
    $("setting-break-sound").value = settings.breakEndSound;
    $("setting-near-end").checked = settings.nearEndNotification;
    $("setting-vibration").value = String(settings.vibration);
    $("setting-white-noise").value = settings.whiteNoise;
  }

  function applySettingsFromForm() {
    const previousDuration = durationForMode(timerState.mode);
    settings = normalizeSettings({
      focusMinutes: $("setting-focus-minutes").value,
      shortBreakMinutes: $("setting-short-break").value,
      longBreakMinutes: $("setting-long-break").value,
      longBreakInterval: $("setting-long-interval").value,
      autoStartFocus: $("setting-auto-focus").checked,
      autoStartBreak: $("setting-auto-break").checked,
      skipBreak: $("setting-skip-break").checked,
      volume: $("setting-volume").value,
      focusEndSound: $("setting-focus-sound").value,
      breakEndSound: $("setting-break-sound").value,
      nearEndNotification: $("setting-near-end").checked,
      vibration: $("setting-vibration").value,
      whiteNoise: $("setting-white-noise").value,
    });
    const nextDuration = durationForMode(timerState.mode);
    if (!timerState.running && previousDuration !== nextDuration) timerState = { ...timerState, duration: nextDuration, remaining: nextDuration * 60, startedAt: null, endAt: null, nearEndNotified: false };
    saveSettings();
    saveTimer();
    renderSettings();
    renderTimer();
    syncNoise();
  }

  function render() {
    $("today").textContent = new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", weekday: "short" }).format(new Date());
    renderTimer();
    renderTasks();
    renderCalendar();
    renderStats();
    renderObsidian();
    renderSettings();
  }

  function addTask() {
    const input = $("task-input");
    const name = input.value.trim();
    if (!name) return;
    const now = Date.now();
    data.tasks.push({ id: now, name, focus: 0, done: false, createdAt: now });
    data.selected = now;
    input.value = "";
    save();
    render();
  }

  async function exportData() {
    const payload = { ...data, settings, timer: timerState, version: 5, exportedAt: new Date().toISOString(), app: "Focus Portable" };
    const file = new File([JSON.stringify(payload, null, 2)], `focus-backup-${localDate()}.json`, { type: "application/json" });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: "Focusデータのバックアップ" });
      else {
        const url = URL.createObjectURL(file);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = file.name;
        anchor.click();
        URL.revokeObjectURL(url);
      }
      $("transfer-text").textContent = "書き出しました。iCloud Driveなど安全な場所へ保存してください。";
    } catch (error) {
      if (error && error.name !== "AbortError") $("transfer-text").textContent = "書き出しに失敗しました。もう一度お試しください。";
    }
  }

  async function importData(file) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed.tasks) || !parsed.history || typeof parsed.history !== "object") throw new Error("invalid");
      data = normalizeState(parsed);
      if (parsed.settings) settings = normalizeSettings(parsed.settings);
      if (parsed.timer && typeof parsed.timer === "object") {
        localStorage.setItem(TIMER_STORE, JSON.stringify(parsed.timer));
        timerState = loadTimer();
      } else timerState = emptyTimer();
      save();
      saveSettings();
      saveTimer();
      selectedDay = localDate();
      viewMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      $("transfer-text").textContent = "読み込みました。タスク表、記録、ポモドーロ設定を確認してください。";
      render();
    } catch (_) {
      $("transfer-text").textContent = "このファイルは読み込めませんでした。";
    } finally {
      $("import-file").value = "";
    }
  }

  function tick() {
    if (!timerState.running) return;
    const remaining = currentRemaining();
    $("timer").textContent = formatClock(remaining);
    timerState.remaining = remaining;
    if (settings.nearEndNotification && timerState.duration > 5 && remaining <= 300 && !timerState.nearEndNotified) {
      timerState.nearEndNotified = true;
      sendNotification("Focus タイマー", `${modeLabel(timerState.mode)}の終了まで5分です`);
    }
    saveTimer();
    if (remaining <= 0) {
      timerState.running = false;
      timerState.endAt = null;
      saveTimer();
      complete(false);
    }
  }

  fillNumberSelect("setting-focus-minutes", 1, 120, "分");
  fillNumberSelect("setting-short-break", 1, 60, "分");
  fillNumberSelect("setting-long-break", 1, 90, "分");
  fillNumberSelect("setting-long-interval", 1, 10, "ポモドーロ");

  $("add-task").addEventListener("click", addTask);
  $("task-input").addEventListener("keydown", (event) => { if (event.key === "Enter") addTask(); });
  $("start-button").addEventListener("click", toggleTimer);
  $("complete-button").addEventListener("click", () => complete(true));
  $("prev-month").addEventListener("click", () => { viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1); selectedDay = localDate(viewMonth); renderCalendar(); });
  $("next-month").addEventListener("click", () => { viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1); selectedDay = localDate(viewMonth); renderCalendar(); });
  $("vault").addEventListener("input", (event) => { data.vault = event.target.value.trim() || "brain"; save(); renderObsidian(); });
  $("open-obsidian").addEventListener("click", () => { $("sync-text").textContent = "Obsidianを開きました"; });
  $("export-data").addEventListener("click", exportData);
  $("import-data").addEventListener("click", () => $("import-file").click());
  $("import-file").addEventListener("change", (event) => importData(event.target.files && event.target.files[0]));
  $("open-settings").addEventListener("click", () => { renderSettings(); $("settings-dialog").showModal(); });
  $("close-settings").addEventListener("click", () => { previewingNoise = false; if (!timerState.running) stopNoise(); $("settings-dialog").close(); });
  $("settings-dialog").addEventListener("click", (event) => { if (event.target === $("settings-dialog")) $("close-settings").click(); });
  ["setting-focus-minutes", "setting-short-break", "setting-long-break", "setting-long-interval", "setting-auto-focus", "setting-auto-break", "setting-skip-break", "setting-focus-sound", "setting-break-sound", "setting-vibration", "setting-white-noise"].forEach((id) => $(id).addEventListener("change", applySettingsFromForm));
  $("setting-volume").addEventListener("input", applySettingsFromForm);
  $("setting-near-end").addEventListener("change", async () => {
    if ($("setting-near-end").checked && !(await requestNotificationPermission())) {
      $("setting-near-end").checked = false;
      $("sync-text").textContent = "通知を許可できませんでした。ホーム画面版でもう一度お試しください";
    }
    applySettingsFromForm();
  });
  $("preview-noise").addEventListener("click", () => {
    ensureAudio();
    previewingNoise = !previewingNoise;
    $("preview-noise").classList.toggle("active", previewingNoise);
    $("preview-noise").textContent = previewingNoise ? "停止する" : "試聴する";
    if (previewingNoise) startNoise(true);
    else if (timerState.running) startNoise(false);
    else stopNoise();
  });

  if (timerState.running && currentRemaining() <= 0) complete(false);
  render();
  if (timerState.running) startNoise(false);
  tickHandle = window.setInterval(tick, 1000);
  window.addEventListener("beforeunload", () => { save(); saveTimer(); saveSettings(); if (tickHandle) window.clearInterval(tickHandle); stopNoise(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { tick(); if (timerState.running) startNoise(false); } });
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("./sw.js").catch(() => undefined);
})();
