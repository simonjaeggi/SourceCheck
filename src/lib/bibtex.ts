/**
 * BibTeX / BibLaTeX (biber) parser for the reference input. Runs in the browser.
 *
 *   parseBib(text) → { entries, errors }
 *     1. scan: @type{key, field = {..} | ".." | 123 | macro # .., ...}; @string macros
 *        and month names expand, @comment / @preamble are skipped, text between
 *        entries is ignored (as BibTeX does). Syntax errors carry a line number, and
 *        the scanner resumes at the next "@" so one broken entry reports once.
 *     2. check the rough shape of every entry with zod (known type, usable key,
 *        a title) — an entry that fails becomes an error too.
 *   toReference(entry) → one reference line in IEEE style ("Authors, “Title,” …"),
 *     the form the OpenAlex lookup reads most reliably (quoted title, DOI, link).
 */
import { z } from "zod"

export type BibEntry = { type: string; key: string; fields: Record<string, string>; line: number }
/** "error" blocks the analysis; "warning" (a repeated field or key) is only shown. */
export type BibError = { line: number; message: string; warning?: boolean }

/** BibTeX and BibLaTeX entry types (lower case). */
export const BIB_TYPES = [
  "article", "book", "mvbook", "inbook", "bookinbook", "suppbook", "booklet", "collection", "mvcollection",
  "incollection", "suppcollection", "dataset", "manual", "misc", "online", "electronic", "www", "patent",
  "periodical", "suppperiodical", "proceedings", "mvproceedings", "inproceedings", "conference", "reference",
  "mvreference", "inreference", "report", "techreport", "set", "software", "thesis", "mastersthesis",
  "phdthesis", "unpublished", "artwork", "audio", "image", "movie", "music", "performance", "video", "standard",
] as const

const MONTHS: Record<string, string> = {
  jan: "January", feb: "February", mar: "March", apr: "April", may: "May", jun: "June",
  jul: "July", aug: "August", sep: "September", oct: "October", nov: "November", dec: "December",
}

/** Rough shape of a usable entry; details are left to the lookup. */
export const BibEntrySchema = z.object({
  type: z.enum(BIB_TYPES, { error: (i) => `unknown entry type @${String(i.input)}` }),
  key: z.string().min(1, "missing citation key").regex(/^[^\s,{}()"#%'=\\]+$/, "the citation key contains spaces or special characters"),
  fields: z
    .record(z.string(), z.string())
    .refine((f) => !!f.title?.trim(), "missing title")
    .refine((f) => !f.year || /^\s*\d{4}/.test(f.year), "year is not a year"),
})

/** Does this look like BibTeX rather than a formatted list? (the first real line starts an entry) */
export function looksLikeBib(text: string): boolean {
  const first = text.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("%"))
  return !!first && /^@[a-z]+\s*[{(]/i.test(first)
}

export function parseBib(text: string): { entries: BibEntry[]; errors: BibError[] } {
  const entries: BibEntry[] = []
  const errors: BibError[] = []
  const macros: Record<string, string> = { ...MONTHS }
  const lineAt = (i: number) => text.slice(0, i).split("\n").length
  let i = 0
  /** where the last value ended, so "missing comma" points at that line */
  let valueEnd = 0

  class SyntaxError extends Error {
    constructor(public at: number, message: string) {
      super(message)
    }
  }
  const ws = () => {
    while (i < text.length) {
      if (/\s/.test(text[i])) i++
      else if (text[i] === "%") while (i < text.length && text[i] !== "\n") i++ // comment to end of line
      else break
    }
  }
  const ident = () => {
    const m = /^[A-Za-z_][\w\-:.+/]*/.exec(text.slice(i, i + 200))
    if (!m) return ""
    i += m[0].length
    return m[0]
  }
  /** {…} with nested braces; returns the inner text. */
  const braced = () => {
    const start = i
    let depth = 0
    for (; i < text.length; i++) {
      const c = text[i]
      if (c === "\\") { i++; continue }
      if (c === "{") depth++
      else if (c === "}" && --depth === 0) { i++; return text.slice(start + 1, i - 1) }
      else if (c === "@" && depth === 1 && text[i - 1] === "\n") break // a new entry started: this brace never closed
    }
    throw new SyntaxError(start, `unclosed "{" (opened on line ${lineAt(start)})`)
  }
  /** "…" where braces inside may contain quotes. */
  const quoted = () => {
    const start = i++
    let depth = 0
    for (; i < text.length; i++) {
      const c = text[i]
      if (c === "\\") { i++; continue }
      if (c === "{") depth++
      else if (c === "}") depth--
      else if (c === '"' && depth === 0) { i++; return text.slice(start + 1, i - 1) }
      else if (c === "\n" && text[i + 1] === "@") break
    }
    throw new SyntaxError(start, `unclosed quote (opened on line ${lineAt(start)})`)
  }
  /** value = part (# part)*; parts are {…}, "…", a number or a @string macro. */
  const value = (): string => {
    let out = ""
    for (;;) {
      ws()
      const c = text[i]
      if (c === "{") out += braced()
      else if (c === '"') out += quoted()
      else if (c !== undefined && /\d/.test(c)) {
        const num = /^\d+/.exec(text.slice(i))![0]
        i += num.length
        out += num
      }
      else if (c !== undefined && /[A-Za-z_]/.test(c)) {
        const at = i
        const name = ident().toLowerCase()
        if (!(name in macros)) throw new SyntaxError(at, `unknown abbreviation "${name}" (put the value in braces, or define it with @string)`)
        out += macros[name]
      } else throw new SyntaxError(i, c === undefined ? "the file ends inside an entry" : `expected a value in braces or quotes, found "${c}"`)
      valueEnd = i
      ws()
      if (text[i] === "#") { i++; continue }
      return out
    }
  }
  /** Skip to the next "@" at the start of a line, after an error. */
  const recover = (from: number) => {
    const next = text.slice(from + 1).search(/\n\s*@/)
    i = next < 0 ? text.length : from + 1 + next + 1
  }

  while (i < text.length) {
    const at = text.indexOf("@", i)
    if (at < 0) break
    i = at + 1
    const startLine = lineAt(at)
    try {
      const type = ident().toLowerCase()
      if (!type) throw new SyntaxError(i, 'expected an entry type after "@", like @article')
      ws()
      const open = text[i]
      if (open !== "{" && open !== "(") throw new SyntaxError(i, `expected "{" after @${type}`)
      const close = open === "{" ? "}" : ")"
      if (type === "comment" || type === "preamble") {
        if (open === "{") braced()
        else i = text.indexOf(")", i) + 1 || text.length
        continue
      }
      i++
      ws()
      if (type === "string") {
        const name = ident().toLowerCase()
        ws()
        if (!name || text[i] !== "=") throw new SyntaxError(i, '@string needs "name = value"')
        i++
        macros[name] = value()
        ws()
        if (text[i] !== close) throw new SyntaxError(i, `expected "${close}" to close @string`)
        i++
        continue
      }
      const keyMatch = /^[^\s,{}()]*/.exec(text.slice(i))![0]
      i += keyMatch.length
      ws()
      if (text[i] !== ",") {
        if (text[i] === close && keyMatch) throw new SyntaxError(i, `@${type}{${keyMatch}} has no fields`)
        throw new SyntaxError(i, keyMatch ? `expected "," after the citation key "${keyMatch}"` : "missing citation key")
      }
      i++
      const fields: Record<string, string> = {}
      for (;;) {
        ws()
        if (text[i] === ",") { i++; continue }
        if (text[i] === close) { i++; break }
        if (i >= text.length) throw new SyntaxError(at, `@${type}{${keyMatch}, …} is never closed`)
        const fieldAt = i
        const name = ident().toLowerCase()
        if (!name) throw new SyntaxError(i, `expected a field name, found "${text[i]}"`)
        ws()
        if (text[i] !== "=") throw new SyntaxError(i, `expected "=" after "${name}"`)
        i++
        const v = value()
        if (name in fields) errors.push({ line: lineAt(fieldAt), message: `@${type}{${keyMatch}}: "${name}" appears twice; the first is used`, warning: true })
        else fields[name] = v
        ws()
        if (text[i] === "@") throw new SyntaxError(at, `@${type}{${keyMatch}, …} is not closed before the next entry (a missing "${close}"?)`)
        if (text[i] !== "," && text[i] !== close) throw new SyntaxError(valueEnd, `expected "," or "${close}" after the value of "${name}" (a missing comma?)`)
      }
      const entry = { type, key: keyMatch, fields, line: startLine }
      const shape = BibEntrySchema.safeParse(entry)
      if (!shape.success) {
        for (const issue of shape.error.issues) errors.push({ line: startLine, message: `@${type}{${keyMatch || "?"}}: ${issue.message}` })
        continue
      }
      if (entries.some((e) => e.key === entry.key)) errors.push({ line: startLine, message: `the citation key "${entry.key}" is used twice`, warning: true })
      entries.push(entry)
    } catch (e) {
      if (!(e instanceof SyntaxError)) throw e
      errors.push({ line: lineAt(e.at), message: e.message })
      recover(at)
    }
  }
  if (!entries.length && !errors.length && text.trim()) errors.push({ line: 1, message: "no entries found; BibTeX entries start with @, like @article{key, …}" })
  return { entries, errors }
}

// ── LaTeX to plain text ──────────────────────────────────────────────────────

const ACCENTS: Record<string, string> = { '"': "\u0308", "'": "\u0301", "`": "\u0300", "^": "\u0302", "~": "\u0303", "=": "\u0304", ".": "\u0307", u: "\u0306", v: "\u030C", H: "\u030B", c: "\u0327", k: "\u0328", r: "\u030A" }
const SYMBOLS: Record<string, string> = { ss: "ß", o: "ø", O: "Ø", ae: "æ", AE: "Æ", oe: "œ", OE: "Œ", aa: "å", AA: "Å", l: "ł", L: "Ł", i: "ı", j: "ȷ", textendash: "–", textemdash: "—", textquoteright: "’", textquoteleft: "‘", ldots: "…", dots: "…", textregistered: "®", texttrademark: "™", copyright: "©" }

export function latexToText(s: string): string {
  return s
    .replace(/\\([`'^"~=.uvHckr])\s*\{?\\?([A-Za-z])\}?/g, (_, acc, ch) => (ch + (ACCENTS[acc] ?? "")).normalize("NFC"))
    .replace(/\\([A-Za-z]+)\{\}|\\([A-Za-z]+)\b\s?/g, (m, a, b) => SYMBOLS[a ?? b] ?? (["textit", "emph", "textbf", "textsc", "texttt", "mkbibquote", "url", "mbox", "textrm", "textsf", "enquote", "textup", "textnormal", "uppercase", "lowercase", "em", "it", "bf", "sc", "tt", "rm", "sf", "relax", "protect"].includes(a ?? b) ? "" : m))
    .replace(/\\([&%$#_{}])/g, "$1")
    .replace(/---/g, "—")
    .replace(/--/g, "–")
    .replace(/~/g, " ")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

/** "Last, First and First Last and others" → ["Last, F.", "Last, F.", "et al."]; braces protect corporate names. */
export function splitNames(raw: string): string[] {
  const parts: string[] = []
  let depth = 0, cur = ""
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]
    if (c === "{") depth++
    if (c === "}") depth--
    if (depth === 0 && /^\s+and\s+/i.test(raw.slice(i)) && /\s/.test(c)) {
      parts.push(cur)
      cur = ""
      i += /^\s+and\s+/i.exec(raw.slice(i))![0].length - 1
      continue
    }
    cur += c
  }
  parts.push(cur)
  return parts.map((p) => p.trim()).filter(Boolean).map((p) => {
    if (/^others$/i.test(p)) return "et al."
    if (/^\{.*\}$/.test(p)) return latexToText(p) // {World Health Organization}
    const text = latexToText(p)
    const [last, first] = text.includes(",") ? [text.split(",")[0], text.split(",").slice(1).join(" ")] : [text.split(" ").pop()!, text.split(" ").slice(0, -1).join(" ")]
    const initials = first.split(/[\s-]+/).filter(Boolean).map((n) => `${n[0]}.`).join(" ")
    return initials ? `${initials} ${last.trim()}` : last.trim()
  })
}

/** One reference line for the lookup, IEEE style, with every detail the entry has. */
export function toReference(e: BibEntry, n: number): string {
  const f = (k: string) => (e.fields[k] ? latexToText(e.fields[k]) : "")
  const names = splitNames(e.fields.author ?? e.fields.editor ?? "")
  const corporate = f("organization") || f("institution")
  const who = names.length ? (names.length > 2 ? `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}` : names.join(" and ")) + (e.fields.author ? "" : ", Ed.") : corporate
  const year = (f("year") || f("date")).match(/\d{4}/)?.[0] ?? ""
  const container = f("journal") || f("journaltitle") || f("booktitle") || f("maintitle") || f("howpublished")
  const doi = f("doi").replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
  const eprint = f("eprint") && /arxiv/i.test(f("eprinttype") || f("archiveprefix")) ? `arXiv:${f("eprint")}` : ""
  const parts = [
    `[${n}] ${who ? `${who}, ` : ""}“${f("title")},”`,
    container && (e.type === "inproceedings" || e.type === "conference" || e.type === "incollection" || e.type === "inbook" ? `in ${container}` : container),
    f("volume") && `vol. ${f("volume")}`,
    (f("number") || f("issue")) && `no. ${f("number") || f("issue")}`,
    f("pages") && `pp. ${f("pages")}`,
    f("publisher") || (names.length && corporate) || f("school"),
    /thesis/.test(e.type) && (e.type === "phdthesis" ? "PhD thesis" : f("type") || "thesis"),
    e.type === "techreport" || e.type === "report" ? "Technical report" : "",
    f("isbn") && `ISBN: ${f("isbn")}`,
    year,
  ].filter(Boolean)
  const tail = [
    doi && `doi: ${doi}.`,
    eprint && `${eprint}.`,
    f("url") && `[Online]. Available: ${f("url")}`,
    f("urldate") && `Accessed: ${f("urldate")}.`,
  ].filter(Boolean)
  return `${parts.join(", ")}.${tail.length ? " " + tail.join(" ") : ""}`.replace(/,”,/, ",”").replace(/,”\./, ".”").replace(/\s+/g, " ").trim()
}
