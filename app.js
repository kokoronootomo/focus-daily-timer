(function () {
  "use strict";

  const STORE = "focus_portable_v1";
  const TIMER_STORE = "focus_portable_timer_v1";
  const IMPORT_KEYS = ["focus_portable_v1", "focus_simple_v3", "focus_simple_v2"];
  const DURATIONS = [25, 50, 90];

  const $ = (id) => document.getElementById(id);

  function localDate(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function emptyState() {
    return { version: 4, tasks: [], selected: null, history: {}, vault: "brain", lastObsidianUri: "" };
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

  function emptyTimer() {
    return { duration: 25, remaining: 25 * 60, startedAt: null, endAt: null, running: false };
  }

  function loadTimer() {
    try {
      const saved = JSON.parse(localStorage.getItem(TIMER_STORE) || "null");
      if (!saved) return emptyTimer();
      const duration = DURATIONS.includes(Number(saved.duration)) ? Number(saved.duration) : 25;
      return {
        duration,
        remaining: Math.max(0, Number(saved.remaining) || duration * 60),
        startedAt: Number(saved.startedAt) || null,
        endAt: Number(saved.endAt) || null,
        running: Boolean(saved.running),
      };
    } catch (_) {
      return emptyTimer();
    }
  }

  let data = loadState();
  let timerState = loadTimer();
  let tickHandle = null;
  let viewMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let selectedDay = localDate();

  function save() {
    localStorage.setItem(STORE, JSON.stringify(data));
  }

  function saveTimer() {
    localStorage.setItem(TIMER_STORE, JSON.stringify(timerState));
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

  function makeObsidianUri(task, minutes, now) {
    const key = localDate(now);
    const time = now.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", hour12: false });
    const content = `\n- ${time}｜${task.name}｜${minutes}分`;
    return `obsidian://new?vault=${encodeURIComponent(data.vault)}&file=${encodeURIComponent(`Focus/${key}`)}&content=${encodeURIComponent(content)}&append&silent`;
  }

  function resetTimer() {
    timerState = { duration: timerState.duration, remaining: timerState.duration * 60, startedAt: null, endAt: null, running: false };
    saveTimer();
  }

  function complete(openObsidian) {
    const task = selectedTask();
    if (!task) {
      $("task-input").focus();
      $("sync-text").textContent = "先にタスクを追加して選んでください";
      return;
    }

    const now = new Date();
    const elapsed = timerState.startedAt ? Math.round((Date.now() - timerState.startedAt) / 60000) : timerState.duration;
    const minutes = Math.min(timerState.duration, Math.max(1, elapsed));
    const key = localDate(now);
    const time = now.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", hour12: false });
    const uri = makeObsidianUri(task, minutes, now);

    data.tasks = data.tasks.map((item) => item.id === task.id ? { ...item, focus: item.focus + minutes, done: true } : item);
    data.history[key] = [...recordsFor(key), { id: now.getTime(), taskId: task.id, taskName: task.name, minutes, time }];
    data.lastObsidianUri = uri;
    save();
    resetTimer();
    selectedDay = key;
    viewMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    $("sync-text").textContent = openObsidian ? "記録しました。Obsidianへ送ります" : "記録しました。必要なら下の再送を押してください";
    render();
    if (openObsidian) window.location.href = uri;
  }

  function setDuration(minutes) {
    if (timerState.running) return;
    timerState = { duration: minutes, remaining: minutes * 60, startedAt: null, endAt: null, running: false };
    saveTimer();
    renderTimer();
  }

  function toggleTimer() {
    if (!selectedTask()) {
      $("task-input").focus();
      $("sync-text").textContent = "先にタスクを追加して選んでください";
      return;
    }
    if (timerState.running) {
      timerState.remaining = currentRemaining();
      timerState.running = false;
      timerState.endAt = null;
    } else {
      if (timerState.remaining <= 0) timerState.remaining = timerState.duration * 60;
      if (!timerState.startedAt) timerState.startedAt = Date.now();
      timerState.endAt = Date.now() + timerState.remaining * 1000;
      timerState.running = true;
    }
    saveTimer();
    renderTimer();
  }

  function renderTimer() {
    const remaining = currentRemaining();
    $("timer").textContent = formatClock(remaining);
    $("current-task").textContent = selectedTask()?.name || "タスクを選んでください";
    $("start-button").textContent = timerState.running ? "一時停止" : timerState.startedAt ? "再開" : "集中開始";
    $("duration-chips").replaceChildren(...DURATIONS.map((minutes) => {
      const button = document.createElement("button");
      button.className = `chip${timerState.duration === minutes ? " active" : ""}`;
      button.textContent = `${minutes}分`;
      button.disabled = timerState.running;
      button.addEventListener("click", () => setDuration(minutes));
      return button;
    }));
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

  function render() {
    $("today").textContent = new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", weekday: "short" }).format(new Date());
    renderTimer();
    renderTasks();
    renderCalendar();
    renderStats();
    renderObsidian();
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
    const payload = { ...data, version: 4, exportedAt: new Date().toISOString(), app: "Focus Portable" };
    const file = new File([JSON.stringify(payload, null, 2)], `focus-backup-${localDate()}.json`, { type: "application/json" });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "Focusデータのバックアップ" });
      } else {
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
      save();
      selectedDay = localDate();
      viewMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      $("transfer-text").textContent = "読み込みました。タスク表とカレンダーを確認してください。";
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
    saveTimer();
    if (remaining <= 0) complete(false);
  }

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

  if (timerState.running && currentRemaining() <= 0) complete(false);
  render();
  tickHandle = window.setInterval(tick, 1000);
  window.addEventListener("beforeunload", () => { save(); saveTimer(); if (tickHandle) window.clearInterval(tickHandle); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("./sw.js").catch(() => undefined);
})();
