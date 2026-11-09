# SourceCheck prototype (layout v0.1)

Clickable layout for the Seminar Prompt Engineering project: paste references + context, get a scored source list.
Mock data only, no API calls yet.

Stack: React 19, Vite, Tailwind CSS v4, shadcn/ui (new-york style, components in `src/components/ui`), Recharts.

## Run
    npm install
    npm run dev            # local dev server
    npm run build          # normal build to dist/
    npm run build:single   # one self-contained dist/index.html

## Where things live
- `src/data/mockWorks.ts`   mock responses shaped like OpenAlex /works + Semantic Scholar fields
- `src/lib/scoring.ts`      provisional metrics (swap once interview results are in)
- `src/components/app/`     traffic light, source list, detail sheet, compare, advanced views
- `src/App.tsx`             page layout

## Planned data sources
- OpenAlex: cited_by_count, fwci, citation_normalized_percentile, is_retracted (Retraction Watch), primary_location.source (type, is_core, is_in_doaj), open_access
- Semantic Scholar Graph API: influentialCitationCount, publicationTypes, tldr
- Crossref: publisher metadata (ACM has no public metadata API of its own; its DOIs are in Crossref)
