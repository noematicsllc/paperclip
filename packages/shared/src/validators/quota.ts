import { z } from "zod";

const optionalNonNegativeInt = z.number().int().nonnegative().optional().nullable();

export const recordSubscriptionCapacitySnapshotSchema = z.object({
  sourceLabel: z.string().trim().min(1).max(160),
  capturedAt: z.string().datetime().optional(),
  weeklyLimit: optionalNonNegativeInt,
  weeklyUsed: optionalNonNegativeInt,
  weeklyRemaining: optionalNonNegativeInt,
  rollingKind: z.string().trim().max(40).optional().nullable(),
  rollingLimit: optionalNonNegativeInt,
  rollingUsed: optionalNonNegativeInt,
  rollingRemaining: optionalNonNegativeInt,
  rollingResetAt: z.string().datetime().optional().nullable(),
}).superRefine((value, ctx) => {
  const hasWeekly = value.weeklyLimit != null || value.weeklyUsed != null || value.weeklyRemaining != null;
  const hasRolling = value.rollingLimit != null || value.rollingUsed != null || value.rollingRemaining != null;
  if (!hasWeekly && !hasRolling) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "at least one weekly or rolling value is required",
    });
  }
});

export type RecordSubscriptionCapacitySnapshot = z.infer<typeof recordSubscriptionCapacitySnapshotSchema>;
