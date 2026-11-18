/**
 * The assessment prompts you can choose from. Only ids and labels live here (shared with
 * the browser); the prompt texts live on the server in server/prompt.ts, keyed by the same
 * ids. The browser can only pick one of these ids, never send or change prompt text.
 *
 * To add a prompt: add its id here, and its text to PROMPT_TEXTS in server/prompt.ts
 * (TypeScript fails until both exist).
 */
import { z } from "zod"

export const PROMPTS = [
  { id: "v2.1", label: "v2.1 (expert form v2)", description: "Rubric and anchors from the expert form v2; strict rules against inferring facts; currency judged against the field." },
] as const

export type PromptId = (typeof PROMPTS)[number]["id"]
export const DEFAULT_PROMPT: PromptId = "v2.1"
export const PROMPT_IDS = PROMPTS.map((p) => p.id) as [PromptId, ...PromptId[]]
export const PromptIdSchema = z.enum(PROMPT_IDS)
export const promptLabel = (id: string) => PROMPTS.find((p) => p.id === id)?.label ?? id
