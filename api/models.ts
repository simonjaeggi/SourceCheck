// Vercel Function: GET /api/models — the free OpenRouter models with structured outputs.
import { handleModels } from "../server/models.js"

export function GET(request: Request) {
  return handleModels(request)
}
