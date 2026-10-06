// Waitlist (W1, W2, W5): staff add, edit, and remove clients.
const listEl = document.querySelector("#list");
const dialog = document.querySelector("#client-dialog");
const form = document.querySelector("#client-form");
const TIMES = [
  ["morning", "Mornings (before 12)"],
  ["afternoon", "Afternoons (12–5)"],
  ["evening", "Evenings (after 5)"],
];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
let clients = [];
let holds = {};
let editingId = null;

function availability(c) {
  const days = c.days.length === 7 ? "Any day"
    : c.days.join() === "1,2,3,4,5" ? "Weekdays"
    : c.days.join() === "0,6" ? "Weekends"
    : WEEK_ORDER.filter((d) => c.days.includes(d)).map((d) => DAY_NAMES[d]).join(", ");
  const times = c.times.length === 3 ? "any time"
    : TIMES.filter(([t]) => c.times.includes(t)).map(([t]) => `${t}s`).join(" & ");
  return `${days}, ${times}`;
}

function joined(iso) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

function status(c) {
  if (holds[c.id]) return `<span class="chip chip-offering">Has an offer now</span>`;
  if (c.stopOffers) return `<span class="chip chip-cancelled">Asked to stop offers</span>`;
  return "";
}

function render() {
  if (clients.length === 0) {
    listEl.innerHTML = `<div class="empty"><h3>The waitlist is empty</h3><p>Add clients who'd like an earlier appointment.</p></div>`;
    return;
  }
  const sorted = [...clients].sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
  listEl.innerHTML = `
    <table class="table">
      <thead><tr><th>#</th><th>Client</th><th>Wants</th><th>Can come</th><th>Joined</th><th></th></tr></thead>
      <tbody>${sorted
        .map((c, i) => `
          <tr>
            <td class="muted">${i + 1}</td>
            <td><div class="name">${escapeHtml(c.name)}</div><div class="small muted">${escapeHtml(c.phone)}</div>${status(c)}</td>
            <td>${escapeHtml(c.service)}<div class="small muted">${c.stylist ? `with ${escapeHtml(c.stylist)}` : "Any stylist"}</div></td>
            <td>${escapeHtml(availability(c))}${c.notes ? `<div class="small muted">${escapeHtml(c.notes)}</div>` : ""}</td>
            <td class="small muted">${joined(c.joinedAt)}</td>
            <td><div class="row">
              <button class="btn-quiet btn-small" data-edit="${escapeHtml(c.id)}">Edit</button>
              <button class="btn-link btn-small" data-remove="${escapeHtml(c.id)}">Remove</button>
            </div></td>
          </tr>`)
        .join("")}</tbody>
    </table>`;
}

async function refresh() {
  const data = await api("/api/staff/waitlist");
  clients = data.clients;
  holds = data.holds;
  render();
}

function openDialog(client) {
  editingId = client?.id ?? null;
  form.reset();
  document.querySelector("#client-error").hidden = true;
  document.querySelector("#client-title").textContent = client ? `Edit ${client.name}` : "Add a client";
  document.querySelector("#client-save").textContent = client ? "Save changes" : "Add to waitlist";
  if (client) {
    form.name.value = client.name;
    form.phone.value = client.phone;
    form.service.value = client.service;
    form.stylist.value = client.stylist ?? "";
    form.notes.value = client.notes;
  }
  form.querySelectorAll("[name=day]").forEach((el) => (el.checked = client ? client.days.includes(Number(el.value)) : true));
  form.querySelectorAll("[name=time]").forEach((el) => (el.checked = client ? client.times.includes(el.value) : true));
  dialog.showModal();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = {
    name: form.name.value,
    phone: form.phone.value,
    service: form.service.value,
    stylist: form.stylist.value || null,
    days: [...form.querySelectorAll("[name=day]:checked")].map((el) => Number(el.value)),
    times: [...form.querySelectorAll("[name=time]:checked")].map((el) => el.value),
    notes: form.notes.value,
  };
  try {
    if (editingId) await api(`/api/staff/waitlist/${encodeURIComponent(editingId)}`, { method: "PUT", body });
    else await api("/api/staff/waitlist", { method: "POST", body });
    dialog.close();
    await refresh();
  } catch (e) {
    const error = document.querySelector("#client-error");
    error.textContent = e.message;
    error.hidden = false;
  }
});

document.querySelector("#client-back").addEventListener("click", () => dialog.close());
document.querySelector("#add").addEventListener("click", () => openDialog(null));

listEl.addEventListener("click", async (event) => {
  const edit = event.target.closest("[data-edit]");
  const remove = event.target.closest("[data-remove]");
  if (edit) openDialog(clients.find((c) => c.id === edit.dataset.edit));
  if (remove) {
    const client = clients.find((c) => c.id === remove.dataset.remove);
    if (!client || !window.confirm(`Remove ${client.name} from the waitlist? They won't receive any more offers.`)) return;
    await api(`/api/staff/waitlist/${encodeURIComponent(client.id)}`, { method: "DELETE" });
    await refresh();
  }
});

(async function start() {
  const meta = await api("/api/staff/meta");
  form.service.innerHTML = meta.services.map((s) => `<option>${escapeHtml(s)}</option>`).join("");
  form.stylist.innerHTML = `<option value="">No preference</option>` +
    meta.stylists.map((s) => `<option>${escapeHtml(s)}</option>`).join("");
  document.querySelector("#days").innerHTML = WEEK_ORDER
    .map((d) => `<label class="check"><input type="checkbox" name="day" value="${d}" />${DAY_NAMES[d]}</label>`)
    .join("");
  document.querySelector("#times").innerHTML = TIMES
    .map(([value, label]) => `<label class="check"><input type="checkbox" name="time" value="${value}" />${label}</label>`)
    .join("");
  await refresh();
  setInterval(() => refresh().catch(console.error), 5000);
})();
