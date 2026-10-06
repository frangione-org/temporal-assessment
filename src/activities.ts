import type { Client } from "@temporalio/client";
import { SALON_WORKFLOW_ID } from "./seed";
import type { BookResult, ClaimResult, OpeningDetails, Settings } from "./types";
import { bookClient, claimCandidate, getSalon, registerOpening, releaseHold } from "./workflows";

// Activities are the only place an opening touches the outside world: the shared
// waitlist (another Workflow) and the text-message provider (simulated here).
export function createActivities(client: Client) {
  const salon = () => client.workflow.getHandle(SALON_WORKFLOW_ID);

  return {
    async getSettings(): Promise<Settings> {
      return (await salon().query(getSalon)).settings;
    },

    async registerOpening(openingId: string): Promise<void> {
      await salon().executeUpdate(registerOpening, { args: [openingId] });
    },

    async claimCandidate(request: {
      openingId: string;
      opening: OpeningDetails;
      excludeIds: string[];
    }): Promise<ClaimResult> {
      return salon().executeUpdate(claimCandidate, { args: [request] });
    },

    async releaseHold(request: { clientId: string; openingId: string }): Promise<void> {
      await salon().executeUpdate(releaseHold, { args: [request] });
    },

    async bookClient(request: { clientId: string; openingId: string }): Promise<BookResult> {
      return salon().executeUpdate(bookClient, { args: [request] });
    },

    // Simulated SMS provider. A number ending in 0000 is rejected so the
    // retry-then-move-on path (O9) can be demonstrated.
    async sendText(message: { to: string; body: string }): Promise<void> {
      if (message.to.replace(/\D/g, "").endsWith("0000")) {
        throw new Error(`Simulated carrier error: ${message.to} could not be reached`);
      }
      console.log(`[simulated text] ${message.to}: ${message.body}`);
    },
  };
}

export type Activities = ReturnType<typeof createActivities>;
