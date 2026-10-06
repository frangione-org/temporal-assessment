export const SERVICES = ["Haircut", "Trim", "Blowout", "Color", "Highlights"] as const;
export const STYLISTS = ["Lena", "Maya", "Theo"] as const;
export const TIMES_OF_DAY = ["morning", "afternoon", "evening"] as const;

export type TimeOfDay = (typeof TIMES_OF_DAY)[number];

// W1: one row of what used to live in the Google Sheet.
export type WaitlistClient = {
  id: string;
  name: string;
  phone: string;
  service: string;
  stylist: string | null; // null means no preference
  days: number[]; // 0 = Sunday … 6 = Saturday
  times: TimeOfDay[];
  notes: string;
  joinedAt: string;
  stopOffers: boolean; // W5
};

export type ClientInput = Omit<WaitlistClient, "id" | "joinedAt" | "stopOffers"> & {
  joinedAt?: string;
};

export type Settings = {
  sameDayHoldMinutes: number; // O5: fixed at 15 by Lena
  nextDayHoldMinutes: number; // O5: adjustable
  quietStart: string; // O8: "HH:MM", local time
  quietEnd: string;
  cutoffMinutes: number; // O7: stop offering this close to the appointment
};

export type OpeningDetails = {
  service: string;
  stylist: string;
  startsAt: string; // ISO timestamp
};

export type OpeningInput = OpeningDetails & {
  openingId: string;
  appUrl: string; // base for the client's private offer link
  // Demo only: divides hold times so a 15-minute hold can be watched in 15 seconds.
  timeScale: number;
};

export type AttemptOutcome =
  | "sending"
  | "holding"
  | "accepted"
  | "declined"
  | "timed-out"
  | "failed"
  | "skipped"
  | "withdrawn";

export type Attempt = {
  clientId: string;
  clientName: string;
  token: string;
  message: string;
  sentAt: string;
  replyBy: string;
  outcome: AttemptOutcome;
  endedAt?: string;
};

export type OpeningStatus = "offering" | "waiting" | "filled" | "unfilled" | "cancelled";

export type OpeningResult = {
  how: "accepted" | "assigned";
  clientId: string;
  clientName: string;
  at: string;
  confirmation: string;
};

export type OpeningState = OpeningDetails & {
  openingId: string;
  createdAt: string;
  status: OpeningStatus;
  detail: string;
  attempts: Attempt[];
  result?: OpeningResult;
};

export type ClaimResult =
  | { kind: "claimed"; client: WaitlistClient }
  | { kind: "busy" }
  | { kind: "none" };

export type BookResult =
  | { ok: true; client: WaitlistClient | null }
  | { ok: false; reason: string };

export type SalonState = {
  clients: WaitlistClient[];
  holds: Record<string, string>; // clientId -> openingId currently offered to them (O4)
  booked: Record<string, string>; // clientId -> openingId they accepted or were assigned (W4)
  openingIds: string[];
  squareUpdated: string[]; // openings staff have marked as entered in Square
  settings: Settings;
};

// C2: everything a client may see about their own offer, and nothing else.
export type OfferView = {
  status: "open" | "accepted" | "declined" | "expired" | "sending";
  firstName: string;
  service: string;
  stylist: string;
  startsAt: string;
  replyBy: string;
};

export type ReplyResult = { result: "accepted" | "declined" | "expired" | "invalid" };
export type StaffActionResult = { ok: true } | { ok: false; reason: string };
