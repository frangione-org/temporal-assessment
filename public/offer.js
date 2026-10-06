// Client offer page (C1–C4, W5). Shows only this client's own offer.
const [, , openingId, token] = window.location.pathname.split("/");
const base = `/api/offers/${encodeURIComponent(openingId)}/${encodeURIComponent(token)}`;
const card = document.querySelector("#offer");
const stopArea = document.querySelector("#stop-area");
const stopButton = document.querySelector("#stop");
let stopped = false;

function detailsList(offer) {
  return `
    <dl class="details-list">
      <dt>Service</dt><dd>${escapeHtml(offer.service)}</dd>
      <dt>Stylist</dt><dd>${escapeHtml(offer.stylist)}</dd>
      <dt>Date</dt><dd>${escapeHtml(formatDate(offer.startsAt))}</dd>
      <dt>Time</dt><dd>${escapeHtml(formatTime(offer.startsAt))}</dd>
    </dl>`;
}

const stillOnList = () => (stopped
  ? "You won't receive future offers."
  : "You're still on our waitlist for the next opening.");

function render(offer) {
  const name = escapeHtml(offer.firstName);
  if (offer.status === "open" || offer.status === "sending") {
    card.innerHTML = `
      <div>
        <h1>Hi ${name}, an earlier appointment opened up</h1>
        <p class="muted" style="margin-top: 6px">It's held just for you. Would you like it?</p>
      </div>
      ${detailsList(offer)}
      <p class="hold-note">Please reply by <strong>${escapeHtml(formatTime(offer.replyBy))}</strong>
        · <span class="countdown" data-countdown="${escapeHtml(offer.replyBy)}">${formatCountdown(offer.replyBy)}</span></p>
      <p class="form-error" id="error" role="alert" hidden></p>
      <div class="big-buttons">
        <button id="accept">Yes, book it</button>
        <button class="btn-quiet" id="decline">No thanks</button>
      </div>`;
    document.querySelector("#accept").addEventListener("click", () => reply("accept"));
    document.querySelector("#decline").addEventListener("click", () => reply("decline"));
    stopArea.hidden = false;
    return;
  }
  stopArea.hidden = offer.status === "accepted";
  if (offer.status === "accepted") {
    // C3: simple confirmation with the appointment details.
    card.innerHTML = `
      <div>
        <h1>You're booked, ${name}!</h1>
        <p class="muted" style="margin-top: 6px">We'll see you then.</p>
      </div>
      ${detailsList(offer)}`;
  } else if (offer.status === "declined") {
    card.innerHTML = `
      <h1>No problem, ${name}</h1>
      <p>Thanks for letting us know. ${stillOnList()}</p>`;
  } else {
    // C4: late or withdrawn offers.
    card.innerHTML = `
      <h1>This offer has expired</h1>
      <p>Sorry, ${name}. The ${escapeHtml(offer.service)} opening on ${escapeHtml(formatDate(offer.startsAt))}
        at ${escapeHtml(formatTime(offer.startsAt))} is no longer available. ${stillOnList()}</p>`;
  }
}

let lastStatus;
async function load() {
  try {
    const offer = await api(base);
    if (offer.status === lastStatus) return; // don't redraw under the client's finger
    lastStatus = offer.status;
    render(offer);
  } catch (e) {
    card.innerHTML = `<h1>We couldn't find this offer</h1><p class="muted">${escapeHtml(e.message)} Please contact Juniper Salon.</p>`;
  }
}

async function reply(answer) {
  card.querySelectorAll("button").forEach((b) => (b.disabled = true));
  try {
    await api(`${base}/reply`, { method: "POST", body: { answer } });
    lastStatus = undefined;
    await load();
  } catch (e) {
    const error = document.querySelector("#error");
    error.textContent = e.message;
    error.hidden = false;
    card.querySelectorAll("button").forEach((b) => (b.disabled = false));
  }
}

// W5: stop future offers; a current offer can still be answered.
stopButton.addEventListener("click", async () => {
  if (!window.confirm("Stop receiving offers for earlier appointments? You can still answer this one.")) return;
  await api(`${base}/stop`, { method: "POST" });
  stopped = true;
  lastStatus = undefined;
  stopArea.innerHTML = `<span class="muted">You won't receive future offers. You can still answer this one.</span>`;
  stopArea.hidden = false;
});

load();
// If the hold runs out while the page is open, show that it expired.
setInterval(load, 5000);
