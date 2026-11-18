# SourceCheck prototype (layout v0.1)

Clickable layout for the Seminar Prompt Engineering project: paste references + context, get a scored source list.
"Analyze sources" looks each reference up in OpenAlex through `/api/lookup`. "Load example" fills in the gold-standard sources (Thesis A: sources 1–5, Thesis B: sources 6–10, each with its own thesis context) or a demo list.
The AI assessment (detail sheet → "Assess with AI") calls an LLM via OpenRouter through `/api/assess`, with the OpenAlex facts in the prompt.

Stack: React 19, Vite, Tailwind CSS v4, shadcn/ui (new-york style, components in `src/components/ui`), Recharts.

## Run
    npm install
    npm run dev            # local dev server
    npm run build          # normal build to dist/
    npm run build:single   # one self-contained dist/index.html (no AI assessment: it needs the API route)
    npx tsx scripts/test-assess.ts   # offline tests for /api/assess (stubbed model, no cost)
    npx tsx scripts/test-lookup.ts   # offline tests for /api/lookup (stubbed OpenAlex) and the exports
    npx tsx scripts/test-bibtex.ts   # offline tests for the BibTeX/BibLaTeX input

## AI assessment and deployment
One Vercel project: the Vite build is the static site, and `api/assess.ts`, `api/lookup.ts` and `api/models.ts` become serverless functions next to it.
Set these in Vercel → Project → Settings → Environment Variables (locally: `.env.local`, which `npm run dev` reads):

| Variable | Required | Purpose |
|---|---|---|
| `OPENROUTER_API_KEY` | yes | OpenRouter API key. Without it the UI shows "not set up". |
| `OPENALEX_API_KEY` | strongly recommended | Free key from openalex.org/settings/api ($1/day of credit, about 1,000 title searches). Without it every request shares an anonymous budget per IP and title searches get throttled quickly; on Vercel that IP is shared with other projects. |
| `OPENROUTER_MODEL` | no | Free OpenRouter model id(s), comma-separated in fallback order. Default `nvidia/nemotron-3.5-super-vl:free`, then `baidu/ernie-5.5-flash-preview:free`. Must end in `:free` (or be `openrouter/free`) and support structured outputs; anything else is refused. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | for real rate limits | Set automatically when you add Upstash Redis from the Vercel Marketplace. Without them limits are per instance only. |
| `RATE_LIMIT_PER_MINUTE` / `RATE_LIMIT_PER_DAY` / `GLOBAL_LIMIT_PER_DAY` | no | AI assessment. Defaults 5 / 40 per IP, 300 in total per day. Raise them (e.g. in `.env.local`) for long test runs. |
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
- `server/models.ts`        /api/models: free OpenRouter models with structured outputs (for the model picker); a model chosen in the UI must be on that list
- `api/assess.ts`, `api/lookup.ts`, `api/models.ts`   Vercel function entry points
- `src/components/app/`     traffic light, source list, detail sheet, compare, advanced views
- `src/App.tsx`             page layout

## Data sources
- In use: OpenAlex (cited_by_count, fwci, citation_normalized_percentile, is_retracted, primary_location.source, open_access, authors' h-index, abstract)
- Possible later: Semantic Scholar Graph API (influentialCitationCount, publicationTypes, tldr)
- Crossref: publisher metadata (ACM has no public metadata API of its own; its DOIs are in Crossref)

## Model choice, export and test runs

- **Model picker** (next to "Assess all"): "Default" uses `OPENROUTER_MODEL` with fallback; any other entry runs that one free model only, with no fallback. The list comes from `/api/models`.
- **Prompt picker** (next to the model picker, and in Test runs): chooses which assessment prompt is used. The prompts are defined in code only: ids and labels in `src/lib/prompts.ts`, texts in `PROMPT_TEXTS` in `server/prompt.ts`. The browser sends just the id, and the server rejects unknown ids, so prompts cannot be edited or injected from the page. To add one, add its id there and its text here; TypeScript fails until both exist. The id is recorded as `prompt_version` in every result and export.
- **Advanced → Export**: one JSON per paper, or all papers in one file. Each record has the reference, the OpenAlex record, the request sent to the AI, the assessment (model, prompt version, attempts, time) and the score.
- **Advanced → Test runs**: tick any number of models (the random `openrouter/free` router is left out) and set the runs per model; every model assesses all papers (or the compare selection) n times, one call at a time, in run-major order (run 1 of every model, then run 2, …). It waits out rate limits and continues. Export as JSON (everything), CSV (one row per run and paper, every criterion as a rating and as a number), or a run comparison CSV: with several models it starts with a model comparison (calls, mean score, run-to-run spread, verdict agreement, per-criterion means), score and verdict per paper and model, then for each model several tables (score, verdict, criteria, per paper and criterion, calls per run) with runs as columns, plus n, mean, sd, min, max, range per row, a mean row per run, and the most common rating with its agreement. Ratings map to very_good 10 … very_weak 0, verdicts to 2/1/0; "no rating" and failed calls stay empty and are not averaged. Test runs do not change the ratings shown in the source list.

## Add details

Sources OpenAlex does not have (not found, or web sources) have an **Add details** button. Paste a DOI to look it up in OpenAlex, or enter the facts yourself, using the same rows as the expert form: how the source is used (sent as `use_of_source`, so relevance is judged for that use), type, published in, authors, year, peer review, venue metric, citations, link, abstract. The source then appears in the list, marked "Added by you", and can be assessed and included in test runs. The AI gets only your facts and the reference, with citations "not indexed in OpenAlex" unless you say otherwise. Nothing is checked automatically.

Found sources have **Edit details** in their detail sheet. A filled field replaces OpenAlex's value for that fact; for example, how the source is used or the venue metric (OpenAlex has neither), or a citation count as of a fixed date. Changing details clears that source's earlier assessment. Exports record `origin` and `details` for every paper.

