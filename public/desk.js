// Front desk: today's openings (F2), filled notices (F3), staff actions (F4), settings (F5).
const openingsEl = document.querySelector("#openings");
const noticesEl = document.querySelector("#notices");
const expanded = new Set();
let latest = { openings: [], settings: null };
let lastJson = "";

const STATUS_LABEL = {
  offering: "Offering",
  waiting: "Paused",
  filled: "Filled",
  unfilled: "Not filled",
  cancelled: "Cancelled",
};

const OUTCOME_LABEL = {
  sending: "Sending text…",
  holding: "Holding the offer",
  accepted: "Accepted",
  declined: "Declined",
  "timed-out": "Didn't reply in time",
  failed: "Text failed to send",
  skipped: "Skipped by staff",
  withdrawn: "Offer withdrawn",
};

const holderOf = (o) => o.attempts.find((a) => a.outcome === "holding" || a.outcome === "sending");
const isOpen = (o) => o.status === "offering" || o.status === "waiting";

function summaryLine(o) {
  const holder = holderOf(o);
  if (holder?.outcome === "holding") {
    return `<strong>${escapeHtml(holder.clientName)}</strong> is holding it · <span class="countdown" data-countdown="${escapeHtml(holder.replyBy)}">${formatCountdown(holder.replyBy)}</span>`;
  }
  if (o.status === "filled" && o.result) {
    const verb = o.result.how === "accepted" ? "accepted" : "was assigned";
    return `<strong>${escapeHtml(o.result.clientName)}</strong> ${verb}`;
  }
  const contacted = o.attempts.length;
  const suffix = !isOpen(o) && contacted ? ` · ${contacted} contacted` : "";
  return `${escapeHtml(o.detail)}${suffix}`;
}

function timeline(o) {
  if (o.attempts.length === 0) return `<p class="muted small">No one has been contacted yet.</p>`;
  return `<ol class="timeline">${o.attempts
    .map((a) => {
      const live = a.outcome === "holding"
        ? ` · reply by ${escapeHtml(formatTime(a.replyBy))} (<span class="countdown" data-countdown="${escapeHtml(a.replyBy)}">${formatCountdown(a.replyBy)}</span>)`
        : a.endedAt ? ` · ${escapeHtml(formatTime(a.endedAt))}` : "";
      const whatClass = a.outcome === "failed" ? "what-failed" : "";
      return `
        <li>
          <span class="dot dot-${a.outcome}"></span>
          <div>
            <span class="who">${escapeHtml(a.clientName)}</span>
            <span class="${whatClass}"> — ${OUTCOME_LABEL[a.outcome]}</span>
            <span class="muted small">· texted ${escapeHtml(formatTime(a.sentAt))}${live}</span>
            <details><summary>Text sent</summary><div class="sms">${escapeHtml(a.message)}</div></details>
          </div>
        </li>`;
    })
    .join("")}</ol>`;
}

function nextUp(o) {
  if (!isOpen(o)) return "";
  const list = o.remaining.length
    ? `<ol class="next-up">${o.remaining
        .map((r) => `<li>${escapeHtml(r.name)}${r.busyElsewhere ? ` <span class="muted small">(holding another offer, will be skipped for now)</span>` : ""}</li>`)
        .join("")}</ol>`
    : `<p class="muted small">No one else on the waitlist matches this opening.</p>`;
  return `<div><p class="section-label">Up next, in waitlist order</p>${list}</div>`;
}

function resultBox(o) {
  if (isOpen(o)) return "";
  let body;
  if (o.status === "filled" && o.result) {
    body = `
      <p><strong>${escapeHtml(o.result.clientName)}</strong> ${o.result.how === "accepted" ? "accepted" : "was assigned by staff"}
        at ${escapeHtml(formatTime(o.result.at))}. ${o.squareUpdated ? "Added to Square." : "<strong>Remember to update Square.</strong>"}</p>
      <details class="small muted" style="margin-top: 6px"><summary>Confirmation sent to client</summary><div class="sms">${escapeHtml(o.result.confirmation)}</div></details>`;
  } else {
    body = `<p>${escapeHtml(o.detail)}</p>`;
  }
  return `<div><p class="section-label">Final result</p><div class="result-box">${body}</div></div>`;
}

function actions(o) {
  if (!isOpen(o)) return "";
  const holder = holderOf(o);
  const skip = holder?.outcome === "holding"
    ? `<button class="btn-quiet btn-small" data-action="skip" data-id="${escapeHtml(o.openingId)}">Skip ${escapeHtml(holder.clientName)}</button>`
    : "";
  return `
    <div class="actions">
      ${skip}
      <button class="btn-quiet btn-small" data-action="assign" data-id="${escapeHtml(o.openingId)}">Assign someone…</button>
      <button class="btn-quiet btn-small" data-action="cancel" data-id="${escapeHtml(o.openingId)}">Cancel this offer</button>
    </div>`;
}

function openingCard(o) {
  const open = expanded.has(o.openingId);
  return `
    <article class="card opening">
      <div class="opening-summary">
        <div class="opening-time">${escapeHtml(formatTime(o.startsAt))}</div>
        <div>
          <div class="opening-title">${escapeHtml(o.service)} with ${escapeHtml(o.stylist)}</div>
          <div class="opening-line">${summaryLine(o)}</div>
        </div>
        <div class="opening-side">
          <span class="chip chip-${o.status}">${STATUS_LABEL[o.status]}</span>
          <button class="btn-link btn-small" data-action="toggle" data-id="${escapeHtml(o.openingId)}" aria-expanded="${open}">
            ${open ? "Hide details" : "Details"}
          </button>
        </div>
      </div>
      ${open ? `
        <div class="opening-details">
          <div><p class="section-label">Who's been contacted</p>${timeline(o)}</div>
          ${nextUp(o)}
          ${resultBox(o)}
          ${actions(o)}
        </div>` : ""}
    </article>`;
}

function render() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const visible = latest.openings.filter((o) => isOpen(o) || new Date(o.startsAt) >= startOfToday);

  // F3: clear "filled" notice until staff confirm it's in Square.
  noticesEl.innerHTML = latest.openings
    .filter((o) => o.status === "filled" && o.result && !o.squareUpdated)
    .map((o) => `
      <div class="notice" role="status">
        <div>
          <strong>${escapeHtml(o.result.clientName)} ${o.result.how === "accepted" ? "accepted" : "was assigned"} an opening</strong>
          <p>${escapeHtml(o.service)} with ${escapeHtml(o.stylist)} · ${escapeHtml(formatDate(o.startsAt))} at ${escapeHtml(formatTime(o.startsAt))}</p>
          <p class="small" style="opacity: 0.9">Please add this to Square.</p>
        </div>
        <button class="btn-quiet btn-small" data-action="square" data-id="${escapeHtml(o.openingId)}">Done, it's in Square</button>
      </div>`)
    .join("");

  if (visible.length === 0) {
    openingsEl.innerHTML = `
      <div class="card empty">
        <h3>No openings right now</h3>
        <p>When someone cancels, add the opening here and we'll start offering it.</p>
      </div>`;
    return;
  }

  let html = "";
  let currentDay = "";
  for (const o of visible) {
    const day = formatDayLabel(o.startsAt);
    if (day !== currentDay) {
      html += `<p class="day-label">${escapeHtml(day)}</p>`;
      currentDay = day;
    }
    html += openingCard(o);
  }
  openingsEl.innerHTML = html;
}

async function refresh() {
  const data = await api("/api/staff/openings");
  const json = JSON.stringify(data.openings);
  latest = data;
  if (json !== lastJson) {
    lastJson = json;
    render();
  }
}

// ── Actions ────────────────────────────────────────────────────────────────

const byId = (id) => latest.openings.find((o) => o.openingId === id);
const describe = (o) => `${o.service} with ${o.stylist}, ${formatDate(o.startsAt)} at ${formatTime(o.startsAt)}`;

const confirmDialog = document.querySelector("#confirm-dialog");
function confirmAction({ title, body, button, withReason, run }) {
  document.querySelector("#confirm-title").textContent = title;
  document.querySelector("#confirm-body").textContent = body;
  document.querySelector("#confirm-reason-label").hidden = !withReason;
  document.querySelector("#confirm-go").textContent = button;
  const error = document.querySelector("#confirm-error");
  error.hidden = true;
  const form = document.querySelector("#confirm-form");
  form.reset();
  form.onsubmit = async (event) => {
    event.preventDefault();
    try {
      const result = await run(form.reason.value);
      if (result && result.ok === false) throw new Error(result.reason);
      confirmDialog.close();
      lastJson = "";
      await refresh();
    } catch (e) {
      error.textContent = e.message;
      error.hidden = false;
    }
  };
  confirmDialog.showModal();
}
document.querySelector("#confirm-back").addEventListener("click", () => confirmDialog.close());

const assignDialog = document.querySelector("#assign-dialog");
document.querySelector("#assign-back").addEventListener("click", () => assignDialog.close());
async function openAssign(o) {
  const form = document.querySelector("#assign-form");
  form.reset();
  const error = document.querySelector("#assign-error");
  error.hidden = true;
  document.querySelector("#assign-body").textContent =
    `${describe(o)}. Use this if you've arranged it with a client yourself. Anyone holding the offer now will be told it's no longer available.`;
  const { clients } = await api("/api/staff/waitlist");
  const holder = holderOf(o);
  const options = [...clients];
  if (holder && !options.some((c) => c.id === holder.clientId)) options.unshift({ id: holder.clientId, name: holder.clientName });
  form.clientId.innerHTML = options
    .map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}${c.service ? ` (${escapeHtml(c.service)})` : ""}</option>`)
    .join("");
  form.onsubmit = async (event) => {
    event.preventDefault();
    try {
      const result = await api(`/api/staff/openings/${encodeURIComponent(o.openingId)}/assign`, {
        method: "POST",
        body: { clientId: form.clientId.value, calendarChecked: form.calendarChecked.checked },
      });
      if (result.ok === false) throw new Error(result.reason);
      assignDialog.close();
      lastJson = "";
      await refresh();
    } catch (e) {
      error.textContent = e.message;
      error.hidden = false;
    }
  };
  assignDialog.showModal();
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const o = byId(button.dataset.id);
  if (!o) return;
  const path = `/api/staff/openings/${encodeURIComponent(o.openingId)}`;
  switch (button.dataset.action) {
    case "toggle":
      expanded.has(o.openingId) ? expanded.delete(o.openingId) : expanded.add(o.openingId);
      render();
      break;
    case "skip": {
      const holder = holderOf(o);
      confirmAction({
        title: `Skip ${holder?.clientName ?? "this client"}?`,
        body: `The offer moves to the next person on the waitlist. ${holder?.clientName ?? "They"} will stay on the waitlist for future openings.`,
        button: "Skip and move on",
        run: () => api(`${path}/skip`, { method: "POST" }),
      });
      break;
    }
    case "cancel":
      confirmAction({
        title: "Cancel this offer?",
        body: `${describe(o)}. No one else will be contacted, and anyone holding it will be told it's no longer available.`,
        button: "Cancel offer",
        withReason: true,
        run: (reason) => api(`${path}/cancel`, { method: "POST", body: { reason } }),
      });
      break;
    case "assign":
      openAssign(o).catch((e) => alert(e.message));
      break;
    case "square":
      button.disabled = true;
      await api(`${path}/square`, { method: "POST" });
      lastJson = "";
      await refresh();
      break;
  }
});

// ── New opening (O1) ────────────────────────────────────────────────────────

const newOpening = document.querySelector("#new-opening");
function resetOpeningForm() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  newOpening.date.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const next = new Date(Math.ceil((now.getTime() + 60 * 60_000) / (30 * 60_000)) * 30 * 60_000);
  newOpening.time.value = `${pad(next.getHours())}:${pad(next.getMinutes())}`;
}
newOpening.addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = document.querySelector("#new-opening-error");
  error.hidden = true;
  const form = event.target;
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const { openingId } = await api("/api/staff/openings", {
      method: "POST",
      body: { service: form.service.value, stylist: form.stylist.value, date: form.date.value, time: form.time.value },
    });
    expanded.add(openingId);
    resetOpeningForm();
    setTimeout(() => refresh(), 600);
  } catch (e) {
    error.textContent = e.message;
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
});

// ── Settings (F5) ───────────────────────────────────────────────────────────

const settingsForm = document.querySelector("#settings");
function fillSettings(settings) {
  const holdChoices = [30, 60, 90, 120, 180, 240, 360, 480, 720];
  if (!holdChoices.includes(settings.nextDayHoldMinutes)) holdChoices.push(settings.nextDayHoldMinutes);
  settingsForm.nextDayHoldMinutes.innerHTML = holdChoices
    .sort((a, b) => a - b)
    .map((m) => `<option value="${m}">${minutesLabel(m)}</option>`)
    .join("");
  settingsForm.nextDayHoldMinutes.value = settings.nextDayHoldMinutes;
  const cutoffChoices = [0, 15, 30, 45, 60, 90, 120];
  if (!cutoffChoices.includes(settings.cutoffMinutes)) cutoffChoices.push(settings.cutoffMinutes);
  settingsForm.cutoffMinutes.innerHTML = cutoffChoices
    .sort((a, b) => a - b)
    .map((m) => `<option value="${m}">${m === 0 ? "Right up to the appointment" : `${minutesLabel(m)} before`}</option>`)
    .join("");
  settingsForm.cutoffMinutes.value = settings.cutoffMinutes;
  settingsForm.quietStart.value = settings.quietStart;
  settingsForm.quietEnd.value = settings.quietEnd;
}
settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const ok = document.querySelector("#settings-ok");
  const error = document.querySelector("#settings-error");
  ok.hidden = true;
  error.hidden = true;
  try {
    const saved = await api("/api/staff/settings", {
      method: "PUT",
      body: {
        nextDayHoldMinutes: Number(settingsForm.nextDayHoldMinutes.value),
        quietStart: settingsForm.quietStart.value,
        quietEnd: settingsForm.quietEnd.value,
        cutoffMinutes: Number(settingsForm.cutoffMinutes.value),
      },
    });
    fillSettings(saved);
    ok.hidden = false;
  } catch (e) {
    error.textContent = e.message;
    error.hidden = false;
  }
});

// ── Start ──────────────────────────────────────────────────────────────────

(async function start() {
  const meta = await api("/api/staff/meta");
  newOpening.service.innerHTML = meta.services.map((s) => `<option>${escapeHtml(s)}</option>`).join("");
  newOpening.stylist.innerHTML = meta.stylists.map((s) => `<option>${escapeHtml(s)}</option>`).join("");
  if (meta.demoSpeed > 1) {
    const note = document.querySelector("#demo-note");
    note.textContent = `Demo speed: reply windows run ${meta.demoSpeed}× faster.`;
    note.hidden = false;
  }
  resetOpeningForm();
  await refresh();
  fillSettings(latest.settings);
  setInterval(() => refresh().catch(console.error), 2000);
})();
