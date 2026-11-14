import { z } from 'zod';
export const fieldMappingParamsSchema=z.object({mappingId:z.string().regex(/^[a-f0-9]{20}$/)}).strict();
export const approveFieldMappingSchema=z.object({value:z.string().trim().min(1).max(1000),aliases:z.string().max(1000).default(''),scope:z.enum(['website','global']).default('website')}).strict();
