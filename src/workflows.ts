import {
  allHandlersFinished,
  condition,
  continueAsNew,
  defineQuery,
  defineUpdate,
  proxyActivities,
  setHandler,
  uuid4,
  workflowInfo,
} from "@temporalio/workflow";
import type { Activities } from "./activities";
import {
  confirmationMessage,
  firstName,
  formatTime,
  isQuietHours,
  isSameDay,
  offerMessage,
  quietHoursEnd,
  rankCandidates,
  withdrawnMessage,
} from "./matching";
import { initialSalonState } from "./seed";
import {
  SERVICES,
  STYLISTS,
  TIMES_OF_DAY,
  type Attempt,
  type AttemptOutcome,
  type BookResult,
  type ClaimResult,
  type ClientInput,
  type OfferView,
  type OpeningDetails,
  type OpeningInput,
  type OpeningResult,
  type OpeningState,
  type OpeningStatus,
  type ReplyResult,
  type SalonState,
  type Settings,
  type StaffActionResult,
  type WaitlistClient,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Salon Workflow: one long-running instance owns the waitlist and settings.
// Because a Workflow processes one Update at a time, claiming a client for an
// opening is atomic — two openings can never hold the same person (O4).
// ─────────────────────────────────────────────────────────────────────────────

export const getSalon = defineQuery<SalonState>("getSalon");
export const addClient = defineUpdate<WaitlistClient, [ClientInput]>("addClient");
export const editClient = defineUpdate<WaitlistClient, [string, ClientInput]>("editClient");
export const removeClient = defineUpdate<void, [string]>("removeClient");
export const stopOffers = defineUpdate<void, [string]>("stopOffers");
export const updateSettings = defineUpdate<Settings, [Partial<Settings>]>("updateSettings");
export const markSquareUpdated = defineUpdate<void, [string]>("markSquareUpdated");
export const registerOpening = defineUpdate<void, [string]>("registerOpening");
export const claimCandidate = defineUpdate<
  ClaimResult,
  [{ openingId: string; opening: OpeningDetails; excludeIds: string[] }]
>("claimCandidate");
export const releaseHold = defineUpdate<void, [{ clientId: string; openingId: string }]>("releaseHold");
export const bookClient = defineUpdate<BookResult, [{ clientId: string; openingId: string }]>("bookClient");

function validateClient(input: ClientInput): void {
  if (!input.name?.trim()) throw new Error("Name is required.");
  if (!input.phone?.trim()) throw new Error("Mobile number is required.");
  if (!(SERVICES as readonly string[]).includes(input.service)) throw new Error("Choose a service.");
  if (input.stylist !== null && !(STYLISTS as readonly string[]).includes(input.stylist)) {
    throw new Error("Choose a stylist or no preference.");
  }
  if (!input.days?.length) throw new Error("Choose at least one day.");
  if (!input.times?.length || !input.times.every((t) => TIMES_OF_DAY.includes(t))) {
    throw new Error("Choose at least one time of day.");
  }
}

function validateSettings(patch: Partial<Settings>): void {
  const isTime = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
  if (patch.quietStart !== undefined && !isTime(patch.quietStart)) throw new Error("Quiet hours need a valid start time.");
  if (patch.quietEnd !== undefined && !isTime(patch.quietEnd)) throw new Error("Quiet hours need a valid end time.");
  if (patch.nextDayHoldMinutes !== undefined && !(patch.nextDayHoldMinutes >= 15 && patch.nextDayHoldMinutes <= 24 * 60)) {
    throw new Error("Next-day reply window must be between 15 minutes and 24 hours.");
  }
  if (patch.cutoffMinutes !== undefined && !(patch.cutoffMinutes >= 0 && patch.cutoffMinutes <= 240)) {
    throw new Error("Stop-offering time must be between 0 and 240 minutes.");
  }
  if (patch.sameDayHoldMinutes !== undefined) throw new Error("The same-day hold is fixed at 15 minutes.");
}

export async function salonWorkflow(initial?: SalonState): Promise<void> {
  const state: SalonState = initial ?? initialSalonState(new Date());
  const findClient = (id: string) => state.clients.find((c) => c.id === id);

  setHandler(getSalon, () => state);

  setHandler(
    addClient,
    (input) => {
      const client: WaitlistClient = {
        ...input,
        name: input.name.trim(),
        phone: input.phone.trim(),
        notes: input.notes?.trim() ?? "",
        id: `c-${uuid4().slice(0, 8)}`,
        joinedAt: input.joinedAt ?? new Date().toISOString(),
        stopOffers: false,
      };
      state.clients.push(client);
      return client;
    },
    { validator: validateClient },
  );

  setHandler(
    editClient,
    (id, input) => {
      const client = findClient(id)!;
      Object.assign(client, {
        name: input.name.trim(),
        phone: input.phone.trim(),
        service: input.service,
        stylist: input.stylist,
        days: input.days,
        times: input.times,
        notes: input.notes?.trim() ?? "",
      });
      return client;
    },
    {
      validator: (id, input) => {
        if (!findClient(id)) throw new Error("That client is no longer on the waitlist.");
        validateClient(input);
      },
    },
  );

  // W2: removal is staff-only. An offer already out to this person runs its course.
  setHandler(removeClient, (id) => {
    state.clients = state.clients.filter((c) => c.id !== id);
  });

  // W5: no future offers; any offer they already hold is unaffected.
  setHandler(stopOffers, (id) => {
    const client = findClient(id);
    if (client) client.stopOffers = true;
  });

  setHandler(
    updateSettings,
    (patch) => {
      state.settings = { ...state.settings, ...patch };
      return state.settings;
    },
    { validator: validateSettings },
  );

  setHandler(markSquareUpdated, (openingId) => {
    if (!state.squareUpdated.includes(openingId)) state.squareUpdated.push(openingId);
  });

  setHandler(registerOpening, (openingId) => {
    if (!state.openingIds.includes(openingId)) state.openingIds.push(openingId);
  });

  setHandler(claimCandidate, ({ openingId, opening, excludeIds }) => {
    const ranked = rankCandidates(state.clients, opening, excludeIds);
    if (ranked.length === 0) return { kind: "none" };
    // O3 + O4: earliest-joined match who is not already holding a different opening.
    const next = ranked.find((c) => state.holds[c.id] === undefined || state.holds[c.id] === openingId);
    if (!next) return { kind: "busy" };
    for (const [clientId, heldBy] of Object.entries(state.holds)) {
      if (heldBy === openingId && clientId !== next.id) delete state.holds[clientId];
    }
    state.holds[next.id] = openingId;
    return { kind: "claimed", client: next };
  });

  setHandler(releaseHold, ({ clientId, openingId }) => {
    if (state.holds[clientId] === openingId) delete state.holds[clientId];
  });

  setHandler(bookClient, ({ clientId, openingId }) => {
    if (state.booked[clientId] === openingId) return { ok: true, client: null }; // retried Activity
    const heldBy = state.holds[clientId];
    const client = findClient(clientId) ?? null;
    if (heldBy !== undefined && heldBy !== openingId) {
      return { ok: false, reason: `${client?.name ?? "That client"} is holding another opening's offer right now.` };
    }
    if (!client && heldBy !== openingId) return { ok: false, reason: "That client is no longer on the waitlist." };
    // W4: booked clients leave the waitlist so they are never offered another opening by mistake.
    state.clients = state.clients.filter((c) => c.id !== clientId);
    delete state.holds[clientId];
    state.booked[clientId] = openingId;
    return { ok: true, client };
  });

  await condition(() => workflowInfo().continueAsNewSuggested);
  await condition(allHandlersFinished);
  await continueAsNew<typeof salonWorkflow>(state);
}

// ─────────────────────────────────────────────────────────────────────────────
// Opening Workflow: one per cancelled appointment. Offers it to one eligible
// client at a time, durably waits out each hold, and moves on by itself.
// ─────────────────────────────────────────────────────────────────────────────

export const getOpening = defineQuery<OpeningState>("getOpening");
export const getOffer = defineQuery<{ clientId: string; view: OfferView } | null, [string]>("getOffer");
export const respondToOffer = defineUpdate<ReplyResult, [string, "accept" | "decline"]>("respondToOffer");
export const skipCurrent = defineUpdate<StaffActionResult>("skipCurrent");
export const cancelOpening = defineUpdate<StaffActionResult, [string]>("cancelOpening");
export const assignClient = defineUpdate<StaffActionResult, [{ clientId: string; calendarChecked: boolean }]>(
  "assignClient",
);

const salon = proxyActivities<Activities>({
  startToCloseTimeout: "10 seconds",
  retry: { maximumAttempts: 5 },
});

// O9: a text gets three tries before it is marked failed.
const sms = proxyActivities<Activities>({
  startToCloseTimeout: "10 seconds",
  retry: { initialInterval: "1 second", backoffCoefficient: 2, maximumAttempts: 3 },
});

const OFFER_STATUS: Record<AttemptOutcome, OfferView["status"]> = {
  sending: "sending",
  holding: "open",
  accepted: "accepted",
  declined: "declined",
  "timed-out": "expired",
  failed: "expired",
  skipped: "expired",
  withdrawn: "expired",
};

export async function openingWorkflow(input: OpeningInput): Promise<OpeningState> {
  const opening: OpeningDetails = { service: input.service, stylist: input.stylist, startsAt: input.startsAt };
  const startsAt = new Date(input.startsAt).getTime();
  const scale = Math.max(input.timeScale, 1);
  const phones = new Map<string, string>(); // kept out of the queryable state

  const state: OpeningState = {
    ...opening,
    openingId: input.openingId,
    createdAt: new Date().toISOString(),
    status: "waiting",
    detail: "Looking for the first match.",
    attempts: [],
  };

  let reply: "accept" | "decline" | undefined;
  let skipRequested = false;
  let cancelReason: string | undefined;
  let assignRequest: { clientId: string } | undefined;
  let assignResult: StaffActionResult | undefined;

  const isOpen = () => state.status === "offering" || state.status === "waiting";
  const holder = () => state.attempts.find((a) => a.outcome === "holding");
  const staffStepIn = () => cancelReason !== undefined || assignRequest !== undefined;

  setHandler(getOpening, () => state);

  // C2: a client's link resolves to their own offer only.
  setHandler(getOffer, (token) => {
    const attempt = state.attempts.find((a) => a.token === token);
    if (!attempt) return null;
    return {
      clientId: attempt.clientId,
      view: {
        ...opening,
        status: OFFER_STATUS[attempt.outcome],
        firstName: firstName(attempt.clientName),
        replyBy: attempt.replyBy,
      },
    };
  });

  setHandler(respondToOffer, async (token, answer) => {
    const attempt = state.attempts.find((a) => a.token === token);
    if (!attempt) return { result: "invalid" };
    if (attempt.outcome === "holding") {
      reply ??= answer;
      await condition(() => attempt.outcome !== "holding");
    }
    if (attempt.outcome === "accepted") return { result: "accepted" };
    if (attempt.outcome === "declined") return { result: "declined" };
    return { result: "expired" }; // C4: the hold ended before this reply arrived
  });

  setHandler(skipCurrent, (): StaffActionResult => {
    if (!holder()) return { ok: false, reason: "No one is holding this opening right now." };
    skipRequested = true;
    return { ok: true };
  });

  setHandler(cancelOpening, async (reason) => {
    if (!isOpen()) return { ok: false, reason: "This opening is already closed." };
    cancelReason = reason.trim() || "Cancelled by staff.";
    await condition(() => !isOpen());
    return { ok: true };
  });

  // F4: manual assignment only after staff confirm they checked the calendar.
  setHandler(assignClient, async ({ clientId, calendarChecked }) => {
    if (!calendarChecked) return { ok: false, reason: "Check the calendar in Square before assigning." };
    if (!isOpen()) return { ok: false, reason: "This opening is already closed." };
    if (assignRequest) return { ok: false, reason: "Another assignment is already in progress." };
    assignRequest = { clientId };
    await condition(() => assignResult !== undefined);
    const result = assignResult!;
    assignResult = undefined;
    return result;
  });

  function close(status: OpeningStatus, detail: string): void {
    state.status = status;
    state.detail = detail;
  }

  async function endAttempt(attempt: Attempt, outcome: AttemptOutcome): Promise<void> {
    attempt.outcome = outcome;
    attempt.endedAt = new Date().toISOString();
    await salon.releaseHold({ clientId: attempt.clientId, openingId: input.openingId });
  }

  async function notify(clientId: string, body: string): Promise<void> {
    const to = phones.get(clientId);
    if (to) await sms.sendText({ to, body }).catch(() => undefined);
  }

  // F3 + C3: filled notice for the front desk, confirmation for the client.
  async function fill(how: OpeningResult["how"], clientId: string, clientName: string): Promise<void> {
    const confirmation = confirmationMessage(clientName, opening);
    state.result = { how, clientId, clientName, at: new Date().toISOString(), confirmation };
    close("filled", `${clientName} ${how === "accepted" ? "accepted" : "was assigned"}. Update Square.`);
    await notify(clientId, confirmation);
  }

  async function processAssign(): Promise<boolean> {
    const { clientId } = assignRequest!;
    const booked = await salon.bookClient({ clientId, openingId: input.openingId });
    assignRequest = undefined;
    if (!booked.ok) {
      assignResult = booked;
      return false;
    }
    const current = holder();
    if (current) {
      if (current.clientId === clientId) {
        current.outcome = "accepted";
        current.endedAt = new Date().toISOString();
      } else {
        await endAttempt(current, "withdrawn");
        await notify(current.clientId, withdrawnMessage(current.clientName, opening));
      }
    }
    if (booked.client) phones.set(clientId, booked.client.phone);
    const name = booked.client?.name ?? state.attempts.find((a) => a.clientId === clientId)?.clientName ?? "Client";
    await fill("assigned", clientId, name);
    assignResult = { ok: true };
    return true;
  }

  // Durable pause that still lets staff cancel or assign immediately.
  async function pause(ms: number): Promise<void> {
    await condition(staffStepIn, Math.max(ms, 1));
  }

  await salon.registerOpening(input.openingId);

  while (isOpen()) {
    if (cancelReason !== undefined) {
      close("cancelled", cancelReason);
      break;
    }
    if (assignRequest) {
      await processAssign();
      continue;
    }

    const settings = await salon.getSettings();
    const now = new Date();
    const cutoffAt = startsAt - settings.cutoffMinutes * 60_000;

    // O7: too close to the appointment to be useful.
    if (now.getTime() >= cutoffAt) {
      close("unfilled", `Stopped offering ${settings.cutoffMinutes} minutes before the appointment.`);
      break;
    }

    // O8: no texts during quiet hours; resume automatically afterward.
    if (isQuietHours(now, settings)) {
      const resume = quietHoursEnd(now, settings);
      close("waiting", `Quiet hours. Offers resume at ${formatTime(resume)}.`);
      await pause(Math.min(resume.getTime(), cutoffAt) - now.getTime());
      continue;
    }

    const claim = await salon.claimCandidate({
      openingId: input.openingId,
      opening,
      excludeIds: state.attempts.map((a) => a.clientId), // W3: declines only count for this opening
    });
    if (claim.kind === "none") {
      close("unfilled", "No eligible clients left on the waitlist.");
      break;
    }
    if (claim.kind === "busy") {
      close("waiting", "Every remaining match is holding another offer. Checking again shortly.");
      await pause(60_000 / scale);
      continue;
    }

    const client = claim.client;
    phones.set(client.id, client.phone);
    // O5: 15 minutes for same-day, the adjustable window otherwise; never past the cutoff.
    const holdMinutes = isSameDay(now, new Date(startsAt)) ? settings.sameDayHoldMinutes : settings.nextDayHoldMinutes;
    const replyBy = new Date(Math.min(now.getTime() + (holdMinutes * 60_000) / scale, cutoffAt));
    const token = uuid4();
    const attempt: Attempt = {
      clientId: client.id,
      clientName: client.name,
      token,
      message: offerMessage(client.name, opening, replyBy, `${input.appUrl}/offer/${input.openingId}/${token}`),
      sentAt: now.toISOString(),
      replyBy: replyBy.toISOString(),
      outcome: "sending",
    };
    state.attempts.push(attempt);
    close("offering", `Texting ${client.name}.`);

    try {
      await sms.sendText({ to: client.phone, body: attempt.message });
    } catch {
      await endAttempt(attempt, "failed"); // O9: mark failed, move on
      continue;
    }

    attempt.outcome = "holding";
    reply = undefined;
    skipRequested = false;
    close("offering", `Waiting for ${client.name} to reply.`);

    while (attempt.outcome === "holding") {
      const remaining = new Date(attempt.replyBy).getTime() - Date.now();
      const woke = await condition(
        () => reply !== undefined || skipRequested || staffStepIn(),
        Math.max(remaining, 1),
      );
      if (reply === "accept") {
        await salon.bookClient({ clientId: client.id, openingId: input.openingId });
        attempt.outcome = "accepted";
        attempt.endedAt = new Date().toISOString();
        await fill("accepted", client.id, client.name);
      } else if (reply === "decline") {
        await endAttempt(attempt, "declined");
      } else if (skipRequested) {
        await endAttempt(attempt, "skipped");
      } else if (cancelReason !== undefined) {
        await endAttempt(attempt, "withdrawn");
        await notify(client.id, withdrawnMessage(client.name, opening));
      } else if (assignRequest) {
        await processAssign(); // on failure the current hold simply continues
      } else if (!woke) {
        await endAttempt(attempt, "timed-out"); // O6
      }
    }
  }

  await condition(allHandlersFinished);
  return state;
}
