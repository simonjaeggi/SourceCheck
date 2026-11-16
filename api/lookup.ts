// Vercel Function: POST /api/lookup. Optional: set OPENALEX_API_KEY in the project's environment variables.
import { handleLookup } from "../server/lookup.js"

export const maxDuration = 60

export function POST(request: Request) {
  return handleLookup(request)
}
