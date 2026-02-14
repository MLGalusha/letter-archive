import { apiPost } from "../client";
import type { Letter } from "../../types/Letter";

export interface ResyncRequest {
  oldSender: string | null;
  newSender: string | null;
  oldRecipient: string | null;
  newRecipient: string | null;
}

export interface ResyncDecision {
  shouldUpdateSummary: boolean;
  shouldUpdateHook: boolean;
  shouldCreateSenderPerson: boolean;
  shouldCreateRecipientPerson: boolean;
  shouldUpdateRelationship: boolean;
  shouldUpdateQuoteContexts: boolean;
  issues: string[];
  reason: string;
}

export interface ResyncResponse {
  letter: Letter;
  resync: {
    wasUpdated: boolean;
    updatedFields: {
      summary: boolean;
      hook: boolean;
      senderPerson: boolean;
      recipientPerson: boolean;
      relationshipType: boolean;
      quoteContexts: boolean;
    };
    decision: ResyncDecision;
  };
}

export interface ResyncCheckResponse {
  needsResync: boolean;
  decision: ResyncDecision;
}

export async function resyncMetadata(
  letterId: string,
  change: ResyncRequest,
): Promise<ResyncResponse> {
  return apiPost<ResyncResponse>(`/admin/letters/${letterId}/resync`, change);
}

export async function checkResyncNeeded(
  letterId: string,
  change: ResyncRequest,
): Promise<ResyncCheckResponse> {
  return apiPost<ResyncCheckResponse>(`/admin/letters/${letterId}/resync-check`, change);
}
