/**
 * GET /api/models: the free OpenRouter models this app can use, for the model picker.
 *
 * "Compatible" means free (":free", zero price) and supporting structured outputs
 * (json_schema), which the assessment requires (provider.require_parameters). The list
 * comes from OpenRouter's public model list, cached per instance for an hour.
 */
import { isFreeModel, modelNames } from "./assess.js"

const MODELS_URL = "https://openrouter.ai/api/v1/models"
const CACHE_MS = 3_600_000

export type ModelInfo = { id: string; name: string; context_length: number | null; router?: boolean }
export type ModelsResult = { ok: true; models: ModelInfo[]; default: string[] } | { ok: false; error: { message: string } }

let cache: { at: number; models: ModelInfo[] } | null = null

export async function compatibleModels(fetcher: typeof fetch = fetch): Promise<ModelInfo[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.models
  const res = await fetcher(MODELS_URL, { headers: { "User-Agent": "SourceCheck-prototype" }, signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`OpenRouter model list returned ${res.status}`)
  const body: any = await res.json()
  const models: ModelInfo[] = (body.data ?? [])
    .filter((m: any) => isFreeModel(m.id) && Number(m.pricing?.prompt ?? 1) === 0 && Number(m.pricing?.completion ?? 1) === 0)
    .filter((m: any) => (m.supported_parameters ?? []).includes("structured_outputs"))
    .map((m: any) => ({ id: m.id, name: m.name ?? m.id, context_length: m.context_length ?? null, ...(m.id === "openrouter/free" ? { router: true } : {}) }))
    // fixed models first, the random router last
    .sort((a: ModelInfo, b: ModelInfo) => Number(!!a.router) - Number(!!b.router) || a.name.localeCompare(b.name))
  cache = { at: Date.now(), models }
  return models
}

/** A model the client may ask for: in the compatible list, or one of the configured defaults. */
export async function isAllowedModel(id: string, fetcher?: typeof fetch): Promise<boolean> {
  if (!isFreeModel(id)) return false
  if (modelNames().includes(id)) return true
  try {
    return (await compatibleModels(fetcher)).some((m) => m.id === id)
  } catch {
    return false
  }
}

export async function handleModels(_request: Request, deps: { fetcher?: typeof fetch } = {}): Promise<Response> {
  try {
    const models = await compatibleModels(deps.fetcher)
    const body: ModelsResult = { ok: true, models, default: modelNames() }
    return Response.json(body, { headers: { "Cache-Control": "public, max-age=600" } })
  } catch (e) {
    console.error("[models]", e)
    const body: ModelsResult = { ok: false, error: { message: "The model list could not be loaded from OpenRouter." } }
    return Response.json(body, { status: 502 })
  }
}

/** For tests. */
export const resetModelCache = () => { cache = null }
