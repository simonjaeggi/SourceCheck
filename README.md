# SourceCheck prototype (layout v0.1)

Clickable layout for the Seminar Prompt Engineering project: paste references + context, get a scored source list.
"Analyze sources" looks each reference up in OpenAlex through `/api/lookup`. "Load example" fills in a sample reference list and thesis context.
The AI assessment (detail sheet → "Assess with AI") calls an LLM via OpenRouter through `/api/assess`, with the OpenAlex facts in the prompt.

Stack: React 19, Vite, Tailwind CSS v4, shadcn/ui (new-york style, components in `src/components/ui`), Recharts.

## Run
    npm install
    npm run dev            # local dev server
    npm run build          # normal build to dist/
    npm run build:single   # one self-contained dist/index.html (no AI assessment: it needs the API route)
    npx tsx scripts/test-assess.ts   # offline tests for /api/assess (stubbed model, no cost)
    npx tsx scripts/test-lookup.ts   # offline tests for /api/lookup (stubbed OpenAlex)

## AI assessment and deployment
One Vercel project: the Vite build is the static site, and `api/assess.ts` and `api/lookup.ts` become serverless functions next to it.
Set these in Vercel → Project → Settings → Environment Variables (locally: `.env.local`, which `npm run dev` reads):

| Variable | Required | Purpose |
|---|---|---|
| `OPENROUTER_API_KEY` | yes | OpenRouter API key. Without it the UI shows "not set up". |
| `OPENALEX_API_KEY` | strongly recommended | Free key from openalex.org/settings/api ($1/day of credit, about 1,000 title searches). Without it every request shares an anonymous budget per IP and title searches get throttled quickly; on Vercel that IP is shared with other projects. |
| `OPENROUTER_MODEL` | no | Free OpenRouter model id(s), comma-separated in fallback order. Default `nvidia/nemotron-3.5-super-vl:free`, then `baidu/ernie-5.5-flash-preview:free`. Must end in `:free` (or be `openrouter/free`) and support structured outputs; anything else is refused. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | for real rate limits | Set automatically when you add Upstash Redis from the Vercel Marketplace. Without them limits are per instance only. |
| `RATE_LIMIT_PER_MINUTE` / `RATE_LIMIT_PER_DAY` / `GLOBAL_LIMIT_PER_DAY` | no | AI assessment. Defaults 5 / 40 per IP, 300 in total per day. |
| `ASSESS_DEBUG` | no | `1` sends the dev panel data (raw LLM output, zod issues, repair prompts) in production too. On by default in `npm run dev`, off in production. |
| `LOOKUP_LIMIT_PER_MINUTE` / `LOOKUP_LIMIT_PER_DAY` | no | OpenAlex lookup. Defaults 6 / 60 per IP. |

How a lookup works (plain code, no AI): references with a DOI are fetched in one batch (`/works?filter=doi:…`);
the rest are searched by title (`/works?search=…`) and only accepted when the found title matches the reference
(otherwise listed as "Not matched"). Author h-indexes and institutions come from one batched `/authors` request.
OpenAlex only supplies facts; there are no heuristic scores. A source has no rating until the AI has assessed it
("Assess" per row, or "Assess all", which runs them one after the other). The AI judges all eight criteria, including
whether the age suits the field, against the overall thesis context (topic and research question), not a per-source use.
The score is the mean of the rated criteria (0 to 10, "no rating" left out); the traffic light is the AI's overall verdict.
The API still accepts an optional `use_of_source`, so gold-standard runs can pass the same facts the experts see.

Free models on OpenRouter have their own limits (about 20 requests per minute, and a daily cap that is low unless the account has bought credits);
when they hit, the UI shows "too many assessments". Free-model providers may log prompts, so thesis texts go to them.

How a request is limited: same-origin check, 12 KB body cap, strict zod input with per-field caps, rate limit, then the model call (OpenRouter chat completions with a strict `json_schema` response format, routed only to providers that honour it).
The model must return JSON matching `AssessmentResponseSchema` (strict zod); if it does not, the zod issues are sent back
to it, at most twice (3 model calls in total). After that the UI shows an error.

## Where things live
- `src/data/types.ts`       the source record (OpenAlex /works fields + SourceCheck fields)
- `src/data/example.ts`     example input for "Load example"
- `src/lib/scoring.ts`      eight rubric criteria; score and light from the AI assessment
- `src/lib/assessClient.ts` builds the assessment request from a source and the thesis context
- `src/lib/assessment.ts`   request/response DTOs (strict zod), limits, error codes, shared by UI and API
- `server/prompt.ts`        system prompt v2 (expert form v2) and message builders
- `server/assess.ts`        /api/assess handler: validation, rate limit, model call, repair loop
- `server/openalex.ts`      OpenAlex client: DOI batch, title search + match check, authors, abstract
- `server/lookup.ts`        /api/lookup handler: validation, rate limit, lookup
- `src/lib/lookup.ts`       lookup request/response DTOs and limits
- `api/assess.ts`, `api/lookup.ts`   Vercel function entry points
- `src/components/app/`     traffic light, source list, detail sheet, compare, advanced views
- `src/App.tsx`             page layout

## Data sources
- In use: OpenAlex (cited_by_count, fwci, citation_normalized_percentile, is_retracted, primary_location.source, open_access, authors' h-index, abstract)
- Possible later: Semantic Scholar Graph API (influentialCitationCount, publicationTypes, tldr)
- Crossref: publisher metadata (ACM has no public metadata API of its own; its DOIs are in Crossref)
