// Pure helpers shared by Workflows and the API. No I/O, so they are safe in Workflow code.
import type { OpeningDetails, Settings, TimeOfDay, WaitlistClient } from "./types";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function timeOfDay(date: Date): TimeOfDay {
  const hour = date.getHours();
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

// O2: same service, available at that day and time, and stylist preference respected.
export function matches(client: WaitlistClient, opening: OpeningDetails): boolean {
  const when = new Date(opening.startsAt);
  return (
    client.service === opening.service &&
    (client.stylist === null || client.stylist === opening.stylist) &&
    client.days.includes(when.getDay()) &&
    client.times.includes(timeOfDay(when))
  );
}

// O3: eligible clients in waitlist order, earliest joined first.
export function rankCandidates(
  clients: WaitlistClient[],
  opening: OpeningDetails,
  excludeIds: string[] = [],
): WaitlistClient[] {
  return clients
    .filter((c) => !c.stopOffers && !excludeIds.includes(c.id) && matches(c, opening))
    .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

// O8: quiet hours may wrap past midnight (e.g. 21:00–08:00). Equal start and end means none.
export function isQuietHours(now: Date, settings: Settings): boolean {
  const start = minutesOf(settings.quietStart);
  const end = minutesOf(settings.quietEnd);
  if (start === end) return false;
  const current = now.getHours() * 60 + now.getMinutes();
  return start < end ? current >= start && current < end : current >= start || current < end;
}

export function quietHoursEnd(now: Date, settings: Settings): Date {
  const end = minutesOf(settings.quietEnd);
  const next = new Date(now.getTime());
  next.setHours(Math.floor(end / 60), end % 60, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next;
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function formatTime(date: Date): string {
  const h = date.getHours();
  const m = date.getMinutes().toString().padStart(2, "0");
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? "AM" : "PM"}`;
}

export function formatWhen(iso: string): string {
  const d = new Date(iso);
  return `${DAY_NAMES[d.getDay()]}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()} at ${formatTime(d)}`;
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

// C1: service, stylist, date, time, reply-by. No price, no other clients.
export function offerMessage(name: string, opening: OpeningDetails, replyBy: Date, link: string): string {
  return (
    `Hi ${firstName(name)}, it's Juniper Salon. An earlier ${opening.service} with ${opening.stylist} ` +
    `just opened: ${formatWhen(opening.startsAt)}. It's held for you until ${formatTime(replyBy)}. ` +
    `Reply here: ${link}`
  );
}

// C3: simple confirmation with the appointment details.
export function confirmationMessage(name: string, opening: OpeningDetails): string {
  return (
    `You're booked, ${firstName(name)}! ${opening.service} with ${opening.stylist}, ` +
    `${formatWhen(opening.startsAt)}. See you at Juniper Salon.`
  );
}

export function withdrawnMessage(name: string, opening: OpeningDetails): string {
  return (
    `Hi ${firstName(name)}, the ${opening.service} opening on ${formatWhen(opening.startsAt)} ` +
    `is no longer available. You're still on our waitlist. — Juniper Salon`
  );
}
