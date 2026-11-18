/**
 * The reference input: plain text (one reference per line) or BibTeX/BibLaTeX.
 * Turns either into the reference lines sent to /api/lookup, and spots input that
 * was probably split wrongly, so the UI can suggest converting it with an LLM.
 */
import { looksLikeBib, parseBib, toReference, type BibError } from "@/lib/bibtex"

export type InputMode = "text" | "bib"

export interface PreparedInput {
  /** reference lines for the lookup */
  lines: string[]
  /** BibTeX problems (mode "bib"); errors block the analysis, warnings do not */
  errors: BibError[]
  /** 1-based line numbers that do not look like a whole reference (mode "text") */
  suspicious: number[]
}

const NUMBERED = /^(\[\d+\]|\d+[.)])\s/

/** Lines that look like a fragment: a wrapped continuation, a heading, or a stray part. */
export function suspiciousLines(lines: string[]): number[] {
  if (lines.length === 0) return []
  const numbered = lines.filter((l) => NUMBERED.test(l)).length / lines.length >= 0.6
  return lines
    .map((l, i) => {
      if (numbered) return NUMBERED.test(l) ? null : i + 1
      const signs = /\b(19|20)\d{2}\b/.test(l) || /https?:\/\/|www\./.test(l) || /\b10\.\d{4,9}\//.test(l) || /[“"].{6,}[”"]/.test(l)
      return l.length < 30 || /^[a-zäöü(,;:–-]/.test(l) || !signs ? i + 1 : null
    })
    .filter((n): n is number => n !== null)
}

export function prepareInput(text: string, mode: InputMode): PreparedInput {
  if (mode === "bib") {
    const { entries, errors } = parseBib(text)
    return { lines: entries.map((e, i) => toReference(e, i + 1)), errors, suspicious: [] }
  }
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean)
  return { lines, errors: [], suspicious: suspiciousLines(lines) }
}

export { looksLikeBib }

/** For the "not in the right format?" hint: paste this plus the list into any LLM. */
export const CONVERT_PROMPT = `Convert the reference list below into BibTeX.

- One entry per source, nothing else: no explanations, no code fences.
- Use @article, @inproceedings, @incollection, @book, @techreport, @thesis, @online or @misc.
- Keep every detail that is in the list: author, title, year, journal or booktitle, volume, number, pages, publisher, isbn, doi, url, and urldate for "accessed" dates.
- Do not add, guess or correct anything that is not in the list.

Reference list:
`
