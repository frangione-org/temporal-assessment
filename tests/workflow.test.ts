import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { createActivities } from "../src/activities";
import { SALON_WORKFLOW_ID } from "../src/seed";
import type { OpeningState, SalonState, WaitlistClient } from "../src/types";
import {
  assignClient,
  cancelOpening,
  getOpening,
  getSalon,
  openingWorkflow,
  respondToOffer,
  salonWorkflow,
  skipCurrent,
} from "../src/workflows";

const TASK_QUEUE = "juniper-test";
let env: TestWorkflowEnvironment;
let worker: Worker;
let workerRun: Promise<void>;

const everyDay = [0, 1, 2, 3, 4, 5, 6];
const allDay: WaitlistClient["times"] = ["morning", "afternoon", "evening"];
function client(id: string, name: string, phone: string, daysAgo: number, extra: Partial<WaitlistClient> = {}): WaitlistClient {
  return {
    id, name, phone, service: "Haircut", stylist: null, days: everyDay, times: allDay, notes: "",
    joinedAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(), stopOffers: false, ...extra,
  };
}

function salonState(): SalonState {
  return {
    clients: [
      client("c-ana", "Ana Ruiz", "555-201-4410", 12, { stylist: "Maya" }),
      client("c-chloe", "Chloe Park", "555-201-0000", 10), // text fails
      client("c-ben", "Ben Ortiz", "555-201-7720", 8),
      client("c-dev", "Dev Patel", "555-201-3381", 20, { stylist: "Theo" }), // wrong stylist
      client("c-gus", "Gus Lindqvist", "555-201-9087", 30, { service: "Color" }), // wrong service
    ],
    holds: {},
    booked: {},
    openingIds: [],
    squareUpdated: [],
    // No quiet hours so the test behaves the same at any time of day.
    settings: { sameDayHoldMinutes: 15, nextDayHoldMinutes: 120, quietStart: "00:00", quietEnd: "00:00", cutoffMinutes: 30 },
  };
}

before(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
  worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: TASK_QUEUE,
    workflowsPath: require.resolve("../src/workflows"),
    activities: createActivities(env.client),
  });
  workerRun = worker.run();
});

after(async () => {
  worker.shutdown();
  await workerRun;
  await env.teardown();
});

async function freshSalon() {
  const existing = env.client.workflow.getHandle(SALON_WORKFLOW_ID);
  await existing.terminate().catch(() => undefined);
  return env.client.workflow.start(salonWorkflow, {
    workflowId: SALON_WORKFLOW_ID,
    taskQueue: TASK_QUEUE,
    args: [salonState()],
  });
}

async function startOpening(id: string) {
  // Tomorrow afternoon: a next-day opening (2-hour hold) that matches everyone's availability.
  const startsAt = new Date(await env.currentTimeMs());
  startsAt.setDate(startsAt.getDate() + 1);
  startsAt.setHours(14, 0, 0, 0);
  return env.client.workflow.start(openingWorkflow, {
    workflowId: id,
    taskQueue: TASK_QUEUE,
    args: [{ openingId: id, service: "Haircut", stylist: "Maya", startsAt: startsAt.toISOString(), appUrl: "http://test", timeScale: 1 }],
  });
}

async function waitFor(handle: { query: (q: typeof getOpening) => Promise<OpeningState> }, check: (s: OpeningState) => boolean) {
  for (let i = 0; i < 200; i++) {
    const state = await handle.query(getOpening);
    if (check(state)) return state;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timed out waiting for opening state: ${JSON.stringify(await handle.query(getOpening))}`);
}

const holding = (s: OpeningState) => s.attempts.find((a) => a.outcome === "holding");

test("offers one at a time in waitlist order, moves on after timeout and failed text, and fills on accept", async () => {
  const salon = await freshSalon();
  const opening = await startOpening("opening-happy");

  // O3: Ana joined earliest among matches (Dev and Gus don't match).
  let state = await waitFor(opening, (s) => holding(s)?.clientId === "c-ana");
  assert.equal(state.attempts.length, 1, "O4: only one person is offered at a time");
  assert.match(state.attempts[0].message, /Haircut with Maya/);
  assert.doesNotMatch(state.attempts[0].message, /\$/, "C1: no price");
  const anaToken = state.attempts[0].token;

  // O5 + O6: the 2-hour next-day hold runs out, then it moves on without staff.
  await env.sleep("121 minutes");
  // O9: Chloe's text fails after retries; Ben is next.
  state = await waitFor(opening, (s) => holding(s)?.clientId === "c-ben");
  assert.deepEqual(
    state.attempts.map((a) => [a.clientId, a.outcome]),
    [["c-ana", "timed-out"], ["c-chloe", "failed"], ["c-ben", "holding"]],
  );

  // C4: Ana's late "yes" is told the offer expired.
  const late = await opening.executeUpdate(respondToOffer, { args: [anaToken, "accept"] });
  assert.equal(late.result, "expired");

  const accepted = await opening.executeUpdate(respondToOffer, { args: [holding(state)!.token, "accept"] });
  assert.equal(accepted.result, "accepted");

  const final = await opening.result();
  assert.equal(final.status, "filled");
  assert.equal(final.result?.clientName, "Ben Ortiz");
  assert.match(final.result!.confirmation, /Haircut with Maya/);

  const waitlist = await salon.query(getSalon);
  assert.ok(!waitlist.clients.some((c) => c.id === "c-ben"), "W4: accepted client leaves the waitlist");
  assert.ok(waitlist.clients.some((c) => c.id === "c-ana"), "W3: a timeout keeps Ana on the waitlist");
  assert.deepEqual(waitlist.holds, {}, "no holds left behind");
});

test("two openings never hold the same client, and staff can skip, assign, and cancel", async () => {
  await freshSalon();
  const first = await startOpening("opening-a");
  await waitFor(first, (s) => holding(s)?.clientId === "c-ana");

  // O4: a second opening skips Ana while she holds the first offer.
  const second = await startOpening("opening-b");
  let secondState = await waitFor(second, (s) => holding(s) !== undefined);
  assert.equal(holding(secondState)!.clientId, "c-ben");

  // F4: skip moves on.
  assert.deepEqual(await second.executeUpdate(skipCurrent), { ok: true });
  secondState = await waitFor(second, (s) => s.attempts.some((a) => a.outcome === "skipped"));

  // F4: assignment requires the calendar check.
  const refused = await first.executeUpdate(assignClient, { args: [{ clientId: "c-ben", calendarChecked: false }] });
  assert.equal(refused.ok, false);
  const assigned = await first.executeUpdate(assignClient, { args: [{ clientId: "c-ben", calendarChecked: true }] });
  assert.deepEqual(assigned, { ok: true });
  const firstFinal = await first.result();
  assert.equal(firstFinal.status, "filled");
  assert.equal(firstFinal.result?.how, "assigned");
  assert.equal(firstFinal.attempts[0].outcome, "withdrawn", "Ana's hold is withdrawn when staff assign someone else");

  assert.deepEqual(await second.executeUpdate(cancelOpening, { args: ["Stylist unavailable"] }), { ok: true });
  const secondFinal = await second.result();
  assert.equal(secondFinal.status, "cancelled");
  assert.equal(secondFinal.detail, "Stylist unavailable");
});
