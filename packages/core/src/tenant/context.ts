import { z } from 'zod';

const NonEmptyStringSchema = z.string().min(1);

export const TenantContextSchema = z.object({
  tenantId: NonEmptyStringSchema,
  userId: NonEmptyStringSchema,
  roles: z.array(NonEmptyStringSchema),
});
export type TenantContext = z.infer<typeof TenantContextSchema>;
