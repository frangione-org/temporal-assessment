import type { SalonState, Settings, WaitlistClient } from "./types";

export const SALON_WORKFLOW_ID = "juniper-salon";
export const TASK_QUEUE = "juniper-waitlist";

// Lena set the 15-minute same-day hold. The rest are placeholders she asked to adjust herself.
export const DEFAULT_SETTINGS: Settings = {
  sameDayHoldMinutes: 15,
  nextDayHoldMinutes: 120,
  quietStart: "21:00",
  quietEnd: "08:00",
  cutoffMinutes: 30,
};

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const ALL_DAY: WaitlistClient["times"] = ["morning", "afternoon", "evening"];

// Fictional sample clients. Chloe's number ends in 0000 to demonstrate a failed text (O9).
export function sampleClients(now: Date): WaitlistClient[] {
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
  const client = (c: Omit<WaitlistClient, "stopOffers" | "notes"> & { notes?: string }): WaitlistClient => ({
    notes: "",
    stopOffers: false,
    ...c,
  });
  return [
    client({ id: "c-ana", name: "Ana Ruiz", phone: "(555) 201-4410", service: "Haircut", stylist: "Maya", days: EVERY_DAY, times: ALL_DAY, joinedAt: daysAgo(12) }),
    client({ id: "c-chloe", name: "Chloe Park", phone: "(555) 201-0000", service: "Haircut", stylist: null, days: EVERY_DAY, times: ALL_DAY, joinedAt: daysAgo(10) }),
    client({ id: "c-ben", name: "Ben Ortiz", phone: "(555) 201-7720", service: "Haircut", stylist: null, days: EVERY_DAY, times: ALL_DAY, joinedAt: daysAgo(8) }),
    client({ id: "c-dev", name: "Dev Patel", phone: "(555) 201-3381", service: "Haircut", stylist: "Theo", days: EVERY_DAY, times: ALL_DAY, joinedAt: daysAgo(7) }),
    client({ id: "c-farah", name: "Farah Nasser", phone: "(555) 201-5532", service: "Haircut", stylist: "Maya", days: [1, 2, 3, 4, 5], times: ["morning"], joinedAt: daysAgo(4), notes: "Weekday mornings before work" }),
    client({ id: "c-elena", name: "Elena Brooks", phone: "(555) 201-6604", service: "Color", stylist: "Lena", days: EVERY_DAY, times: ["afternoon", "evening"], joinedAt: daysAgo(5) }),
    client({ id: "c-gus", name: "Gus Lindqvist", phone: "(555) 201-9087", service: "Blowout", stylist: null, days: [5, 6], times: ALL_DAY, joinedAt: daysAgo(2) }),
  ];
}

export function initialSalonState(now: Date): SalonState {
  return {
    clients: sampleClients(now),
    holds: {},
    booked: {},
    openingIds: [],
    squareUpdated: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}
