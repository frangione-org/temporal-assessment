import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { Client, Connection, WorkflowUpdateFailedError } from "@temporalio/client";
import express, { type NextFunction, type Request, type Response } from "express";
import { rankCandidates } from "./matching";
import { SALON_WORKFLOW_ID, TASK_QUEUE } from "./seed";
import { SERVICES, STYLISTS, type ClientInput, type OpeningState, type Settings } from "./types";
import {
  addClient,
  assignClient,
  cancelOpening,
  editClient,
  getOffer,
  getOpening,
  getSalon,
  markSquareUpdated,
  openingWorkflow,
  removeClient,
  respondToOffer,
  salonWorkflow,
  skipCurrent,
  stopOffers,
  updateSettings,
} from "./workflows";

const port = Number(process.env.PORT ?? 3000);
const appUrl = process.env.APP_URL ?? `http://localhost:${port}`;
// F1: one shared staff sign-in. Prototype only — see docs/requirements.md.
const staffPasscode = process.env.STAFF_PASSCODE ?? "juniper";
// Demo only: DEMO_SPEED=60 turns a 15-minute hold into 15 seconds.
const timeScale = Math.max(Number(process.env.DEMO_SPEED ?? 1) || 1, 1);

const publicDir = path.join(process.cwd(), "public");
const pagesDir = path.join(process.cwd(), "pages");

const app = express();
app.use(express.json());
app.use(express.static(publicDir, { index: false }));

let clientPromise: Promise<Client> | undefined;
function getClient(): Promise<Client> {
  clientPromise ??= Connection.connect({ address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233" }).then(
    async (connection) => {
      const client = new Client({ connection, namespace: "default" });
      // The salon Workflow is the single home of the waitlist; start it once, reuse it after.
      await client.workflow.start(salonWorkflow, {
        workflowId: SALON_WORKFLOW_ID,
        taskQueue: TASK_QUEUE,
        args: [],
        workflowIdConflictPolicy: "USE_EXISTING",
      });
      return client;
    },
  );
  return clientPromise;
}

const salon = async () => (await getClient()).workflow.getHandle(SALON_WORKFLOW_ID);
const opening = async (id: string) => (await getClient()).workflow.getHandle(id);

// ── Staff sign-in (F1) ──────────────────────────────────────────────────────

const SESSION_COOKIE = "juniper_staff";
const sessionSecret = randomBytes(32).toString("hex");
const sessionValue = createHash("sha256").update(`${sessionSecret}:${staffPasscode}`).digest("hex");

function isStaff(request: Request): boolean {
  const cookie = request.headers.cookie ?? "";
  const value = cookie
    .split(";")
    .map((part) => part.trim().split("="))
    .find(([name]) => name === SESSION_COOKIE)?.[1];
  return value !== undefined && value.length === sessionValue.length &&
    timingSafeEqual(Buffer.from(value), Buffer.from(sessionValue));
}

function requireStaff(request: Request, response: Response, next: NextFunction): void {
  if (isStaff(request)) return next();
  if (request.originalUrl.startsWith("/api/")) response.status(401).json({ error: "Please sign in." });
  else response.redirect("/");
}

app.post("/api/login", (request, response) => {
  const passcode = String(request.body?.passcode ?? "");
  const ok = passcode.length === staffPasscode.length &&
    timingSafeEqual(Buffer.from(passcode), Buffer.from(staffPasscode));
  if (!ok) {
    response.status(401).json({ error: "That passcode didn't match." });
    return;
  }
  response.setHeader("Set-Cookie", `${SESSION_COOKIE}=${sessionValue}; HttpOnly; SameSite=Strict; Path=/`);
  response.json({ ok: true });
});

app.post("/api/logout", (_request, response) => {
  response.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  response.json({ ok: true });
});

// ── Pages ───────────────────────────────────────────────────────────────────

// F1: signing in goes straight to today's openings — no welcome page.
app.get("/", (request, response) => {
  if (isStaff(request)) response.redirect("/desk");
  else response.sendFile(path.join(pagesDir, "login.html"));
});
app.get("/desk", requireStaff, (_request, response) => response.sendFile(path.join(pagesDir, "desk.html")));
app.get("/waitlist", requireStaff, (_request, response) => response.sendFile(path.join(pagesDir, "waitlist.html")));
// C2: the client page is reachable only through its private link.
app.get("/offer/:openingId/:token", (_request, response) => response.sendFile(path.join(pagesDir, "offer.html")));

// ── Staff API ───────────────────────────────────────────────────────────────

const staff = express.Router();
staff.use(requireStaff);

staff.get("/meta", (_request, response) => {
  response.json({ services: SERVICES, stylists: STYLISTS, demoSpeed: timeScale });
});

staff.get("/waitlist", async (_request, response) => {
  const state = await (await salon()).query(getSalon);
  response.json({ clients: state.clients, holds: state.holds, settings: state.settings });
});

staff.post("/waitlist", async (request, response) => {
  const client = await (await salon()).executeUpdate(addClient, { args: [clientInput(request.body)] });
  response.status(201).json(client);
});

staff.put("/waitlist/:id", async (request, response) => {
  const client = await (await salon()).executeUpdate(editClient, {
    args: [String(request.params.id), clientInput(request.body)],
  });
  response.json(client);
});

staff.delete("/waitlist/:id", async (request, response) => {
  await (await salon()).executeUpdate(removeClient, { args: [String(request.params.id)] });
  response.json({ ok: true });
});

staff.put("/settings", async (request, response) => {
  const body = request.body ?? {};
  const patch: Partial<Settings> = {};
  if (body.nextDayHoldMinutes !== undefined) patch.nextDayHoldMinutes = Number(body.nextDayHoldMinutes);
  if (body.quietStart !== undefined) patch.quietStart = String(body.quietStart);
  if (body.quietEnd !== undefined) patch.quietEnd = String(body.quietEnd);
  if (body.cutoffMinutes !== undefined) patch.cutoffMinutes = Number(body.cutoffMinutes);
  response.json(await (await salon()).executeUpdate(updateSettings, { args: [patch] }));
});

// F2: every opening with its timeline, current holder, and remaining candidates in order.
staff.get("/openings", async (_request, response) => {
  const state = await (await salon()).query(getSalon);
  const openings = await Promise.all(
    state.openingIds.map(async (id) => {
      const o: OpeningState = await (await opening(id)).query(getOpening);
      const active = o.status === "offering" || o.status === "waiting";
      const remaining = active
        ? rankCandidates(state.clients, o, o.attempts.map((a) => a.clientId)).map((c) => ({
            id: c.id,
            name: c.name,
            busyElsewhere: state.holds[c.id] !== undefined && state.holds[c.id] !== o.openingId,
          }))
        : [];
      return { ...o, remaining, squareUpdated: state.squareUpdated.includes(id) };
    }),
  );
  openings.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  response.json({ openings, settings: state.settings, now: new Date().toISOString() });
});

// O1: service, stylist, date, time.
staff.post("/openings", async (request, response) => {
  const { service, stylist, date, time } = request.body ?? {};
  if (!SERVICES.includes(service)) return badRequest(response, "Choose a service.");
  if (!STYLISTS.includes(stylist)) return badRequest(response, "Choose a stylist.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || !/^\d{2}:\d{2}$/.test(time ?? "")) {
    return badRequest(response, "Choose a date and time.");
  }
  const startsAt = new Date(`${date}T${time}`); // salon's local time
  if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() <= Date.now()) {
    return badRequest(response, "That time has already passed.");
  }
  const openingId = `opening-${date}-${time.replace(":", "")}-${stylist.toLowerCase()}-${randomBytes(2).toString("hex")}`;
  await (await getClient()).workflow.start(openingWorkflow, {
    workflowId: openingId,
    taskQueue: TASK_QUEUE,
    args: [{ openingId, service, stylist, startsAt: startsAt.toISOString(), appUrl, timeScale }],
  });
  response.status(201).json({ openingId });
});

staff.post("/openings/:id/skip", async (request, response) => {
  response.json(await (await opening(String(request.params.id))).executeUpdate(skipCurrent));
});

staff.post("/openings/:id/cancel", async (request, response) => {
  const reason = String(request.body?.reason ?? "");
  response.json(await (await opening(String(request.params.id))).executeUpdate(cancelOpening, { args: [reason] }));
});

staff.post("/openings/:id/assign", async (request, response) => {
  const { clientId, calendarChecked } = request.body ?? {};
  response.json(
    await (await opening(String(request.params.id))).executeUpdate(assignClient, {
      args: [{ clientId: String(clientId ?? ""), calendarChecked: calendarChecked === true }],
    }),
  );
});

staff.post("/openings/:id/square", async (request, response) => {
  await (await salon()).executeUpdate(markSquareUpdated, { args: [String(request.params.id)] });
  response.json({ ok: true });
});

app.use("/api/staff", staff);

// ── Client API (C2–C4, W5): only ever returns the token holder's own offer ──

async function findOffer(openingId: string, token: string) {
  try {
    return await (await opening(openingId)).query(getOffer, token);
  } catch {
    return null;
  }
}

app.get("/api/offers/:openingId/:token", async (request, response) => {
  const offer = await findOffer(String(request.params.openingId), String(request.params.token));
  if (!offer) return notFound(response);
  response.json(offer.view);
});

app.post("/api/offers/:openingId/:token/reply", async (request, response) => {
  const openingId = String(request.params.openingId);
  const token = String(request.params.token);
  const answer = request.body?.answer === "accept" ? "accept" : "decline";
  const offer = await findOffer(openingId, token);
  if (!offer) return notFound(response);
  try {
    const result = await (await opening(openingId)).executeUpdate(respondToOffer, { args: [token, answer] });
    response.json(result);
  } catch {
    // The opening has already closed, so this reply is too late (C4).
    response.json({ result: "expired" });
  }
});

app.post("/api/offers/:openingId/:token/stop", async (request, response) => {
  const offer = await findOffer(String(request.params.openingId), String(request.params.token));
  if (!offer) return notFound(response);
  await (await salon()).executeUpdate(stopOffers, { args: [offer.clientId] });
  response.json({ ok: true });
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function clientInput(body: Record<string, unknown> | undefined): ClientInput {
  const b = body ?? {};
  return {
    name: String(b.name ?? ""),
    phone: String(b.phone ?? ""),
    service: String(b.service ?? ""),
    stylist: b.stylist ? String(b.stylist) : null,
    days: Array.isArray(b.days) ? b.days.map(Number) : [],
    times: Array.isArray(b.times) ? (b.times as ClientInput["times"]) : [],
    notes: String(b.notes ?? ""),
  };
}

function badRequest(response: Response, error: string): void {
  response.status(400).json({ error });
}

function notFound(response: Response): void {
  response.status(404).json({ error: "This offer link isn't valid." });
}

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  // Update validators reject bad input before anything is recorded; show their message.
  if (error instanceof WorkflowUpdateFailedError) {
    response.status(400).json({ error: error.cause?.message ?? error.message });
    return;
  }
  console.error(error);
  response.status(500).json({ error: error instanceof Error ? error.message : "Unexpected error" });
});

app.listen(port, () => console.log(`Juniper Salon waitlist is available at ${appUrl}`));
