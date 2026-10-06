// Small helpers shared by every page.
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (response.status === 401 && !path.startsWith("/api/login")) {
    window.location.href = "/";
    throw new Error("Please sign in.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "Something went wrong. Please try again.");
  return data;
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
}

function formatDayLabel(iso) {
  const date = new Date(iso);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return formatDate(iso);
}

function formatCountdown(untilIso) {
  const ms = new Date(untilIso).getTime() - Date.now();
  if (ms <= 0) return "time's up";
  const totalSeconds = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours} hr ${minutes} min left`;
  if (minutes > 0) return `${minutes} min ${String(seconds).padStart(2, "0")} s left`;
  return `${seconds} s left`;
}

function minutesLabel(minutes) {
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  if (minutes > 60) return `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
  return `${minutes} minutes`;
}

function to12h(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

// Live countdowns tick every second without re-rendering the page.
setInterval(() => {
  document.querySelectorAll("[data-countdown]").forEach((el) => {
    el.textContent = formatCountdown(el.dataset.countdown);
  });
}, 1000);

async function signOut() {
  await api("/api/logout", { method: "POST" }).catch(() => undefined);
  window.location.href = "/";
}
