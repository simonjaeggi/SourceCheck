// Vercel Function: POST /api/assess. Set OPENROUTER_API_KEY (and optionally OPENROUTER_MODEL) in the Vercel project's environment variables.
import { handleAssess } from "../server/assess"

// Free models are slow (~30–50 s per call) and an assessment can take 3 calls; 300 s is the Hobby maximum.
export const maxDuration = 300

export function POST(request: Request) {
  return handleAssess(request)
}
