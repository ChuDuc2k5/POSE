import { z } from 'zod';

export const SearchFiltersSchema = z.object({
  transaction_type: z.enum(['Sale', 'Rent']).nullable().default(null),
  property_type: z.enum(['Apartment', 'House', 'Land', 'Villa', 'Office', 'Shop']).nullable().default(null),
  location: z.string().trim().min(1).max(120).nullable().default(null),
  min_price_vnd: z.number().finite().nonnegative().max(1e15).nullable().default(null),
  max_price_vnd: z.number().finite().nonnegative().max(1e15).nullable().default(null),
  bedrooms: z.number().int().nonnegative().max(100).nullable().default(null),
}).refine(v => v.min_price_vnd === null || v.max_price_vnd === null || v.min_price_vnd <= v.max_price_vnd, 'min_price_vnd must not exceed max_price_vnd');

export const SearchQuerySchema = z.object({
  topic: z.enum(['real_estate', 'smalltalk', 'out_of_scope']),
  standalone_question: z.string().trim().min(1).max(2000),
  keywords: z.array(z.string().trim().min(1).max(80)).max(8).default([]),
  filters: SearchFiltersSchema,
  refers_to_previous: z.array(z.number().int().positive().max(100)).max(20),
});

export const AnswerMetaSchema = z.object({
  grounding: z.enum(['grounded', 'partial', 'none']),
  cited: z.array(z.number().int().positive().max(100)).max(20),
  claims: z.array(z.object({
    type: z.enum(['price', 'availability', 'legal', 'promotion', 'other']),
    text: z.string().trim().min(1).max(1000),
  })).max(20),
});

export const NeedEntrySchema = z.object({
  field: z.enum(['budget_min_vnd', 'budget_max_vnd', 'locations', 'property_types', 'timeline', 'purchase_intent', 'contact_ready', 'next_step']),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
  evidence: z.string().trim().min(1).max(2000),
});

export const NeedsV1Schema = z.array(NeedEntrySchema).max(8);

export const ToolArgs = {
  search_properties: z.object({ query: z.string().trim().min(1).max(2000), filters: SearchFiltersSchema }),
  get_property_detail: z.object({ code: z.string().trim().min(1).max(40) }),
  list_my_appointments: z.object({}),
  save_favorite: z.object({ code: z.string().trim().min(1).max(40) }),
  request_handoff: z.object({ summary: z.string().trim().min(3).max(2000) }),
  propose_appointment: z.object({ code: z.string().trim().max(40).nullable().default(null), preferred_start: z.string().datetime(), preferred_end: z.string().datetime().nullable().default(null) }),
} as const;

export const ToolNameSchema = z.enum(['search_properties', 'get_property_detail', 'list_my_appointments', 'save_favorite', 'request_handoff', 'propose_appointment']);
export const ToolCallSchema = z.object({ name: ToolNameSchema, arguments: z.unknown() });
export type SearchQuery = z.infer<typeof SearchQuerySchema>;
export type AnswerMeta = z.infer<typeof AnswerMetaSchema>;
export type NeedEntry = z.infer<typeof NeedEntrySchema>;
export type ToolName = z.infer<typeof ToolNameSchema>;
