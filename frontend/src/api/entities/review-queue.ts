import { apiGet, apiPost } from "../client";
import type { EntityReviewItem, ReviewQueueStats } from "./types";

export async function getReviewQueue(entityType?: "person" | "place"): Promise<{
  items: EntityReviewItem[];
  stats: ReviewQueueStats;
}> {
  return apiGet<{ items: EntityReviewItem[]; stats: ReviewQueueStats }>(
    "/admin/entities/review",
    entityType ? { type: entityType } : undefined,
  );
}

export async function resolveReviewItem(
  itemId: string,
  resolution: {
    status: "confirmed" | "rejected" | "new_entity";
    reviewedBy?: string;
  },
): Promise<{ message: string }> {
  return apiPost<{ message: string }>(`/admin/entities/review/${itemId}/resolve`, resolution);
}
