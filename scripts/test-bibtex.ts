/**
 * Offline tests for the BibTeX / BibLaTeX input and the plain-text checks.
 * Run: npx tsx scripts/test-bibtex.ts
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { latexToText, looksLikeBib, parseBib, splitNames, toReference } from "../src/lib/bibtex"
import { prepareInput, suspiciousLines } from "../src/lib/referenceInput"
import { extractDoi, extractYear, isWebSource, parseTitle } from "../server/openalex"

const GOOD = `% my library
@string{ieeea = "IEEE Access"}
@article{maswadi2020,
  author = {Maswadi, Kholoud and Ghani, Norjihan Binti Abdul and Hamid, Suraya Binti},
  title = {Systematic Literature Review of Smart Home Monitoring Technologies Based on {IoT} for the Elderly},
  journal = ieeea,
  volume = 8, pages = {92244--92261}, year = 2020,
  doi = {10.1109/ACCESS.2020.2992727},
}
@book{gamma1995,
  editor = {Gamma, Erich},
  title = "Design Patterns: Elements of Reusable Object-Oriented Software",
  publisher = {Addison-Wesley}, year = {1995}, isbn = {978-0-201-63361-0}
}
@online(cloudflare,
  title = {Cloudflare Tunnel},
  organization = {Cloudflare Docs},
  url = {https://developers.cloudflare.com/cloudflare-one/},
  urldate = {2026-04-27}
)
@comment{ignored {nested} text}
@misc{who, author = {{World Health Organization}}, title = {Dementia}, date = {2023-06}, month = jun # "~1", url = {https://www.who.int/x}}
`

const tests: [string, () => void][] = [
  ["valid file: entries, macros, parentheses, comments, BibLaTeX dates", () => {
    const { entries, errors } = parseBib(GOOD)
    assert.deepEqual(errors, [])
    assert.deepEqual(entries.map((e) => e.key), ["maswadi2020", "gamma1995", "cloudflare", "who"])
    assert.equal(entries[0].fields.journal, "IEEE Access")
    assert.equal(entries[0].fields.volume, "8")
    assert.equal(entries[3].fields.month, "June~1")
    assert.equal(entries[2].line, 15)
  }],
  ["references built from entries are read correctly by the lookup", () => {
    const refs = parseBib(GOOD).entries.map((e, i) => toReference(e, i + 1))
    assert.equal(refs[0], "[1] K. Maswadi, N. B. A. Ghani, and S. B. Hamid, “Systematic Literature Review of Smart Home Monitoring Technologies Based on IoT for the Elderly,” IEEE Access, vol. 8, pp. 92244–92261, 2020. doi: 10.1109/ACCESS.2020.2992727.")
    assert.equal(extractDoi(refs[0]), "10.1109/access.2020.2992727")
    // quoted titles; under 10 characters ("Dementia") the lookup does not treat a quote as a title
    assert.deepEqual(refs.map((r) => parseTitle(r).reliable), [true, true, true, false])
    assert.equal(parseTitle(refs[1]).title, "Design Patterns: Elements of Reusable Object-Oriented Software")
    assert.equal(extractYear(refs[1]), 1995)
    assert.deepEqual(refs.map(isWebSource), [false, false, true, true], "a book is searched, @online and a web @misc are web sources")
    assert.match(refs[2], /Accessed: 2026-04-27\.$/)
  }],
  ["syntax errors name the line and the scanner recovers", () => {
    const text = `@article{a, title = {One}, year = 2020}
@article{broken,
  title = {Missing comma here}
  year = {2020}
}
@article{nokey}
@article{unclosed, title = {Never closed,
  year = 2021}
@article{b, title = "Two", journal = foo}
@article{c, title = {Three}}`
    const { entries, errors } = parseBib(text)
    assert.deepEqual(entries.map((e) => e.key), ["a", "c"])
    assert.deepEqual(errors.map((e) => e.line), [3, 6, 7, 9])
    assert.match(errors[0].message, /missing comma/)
    assert.match(errors[1].message, /has no fields/)
    assert.match(errors[2].message, /not closed before the next entry/)
    assert.match(errors[3].message, /unknown abbreviation "foo"/)
  }],
  ["zod checks the rough shape: type, key, title, year", () => {
    const { errors } = parseBib(`@artcle{t1, title = {Typo}}
@article{t2, author = {X, Y}}
@article{bad key!, title = {Key}}
@article{t3, title = {Year}, year = {soon}}`)
    assert.deepEqual(errors.map((e) => e.message), [
      "@artcle{t1}: unknown entry type @artcle",
      "@article{t2}: missing title",
      'expected "," after the citation key "bad"',
      "@article{t3}: year is not a year",
    ])
  }],
  ["repeated fields and keys are warnings, not errors", () => {
    const { entries, errors } = parseBib(`@article{a, title = {One}, title = {Again}}
@article{a, title = {Two}}`)
    assert.equal(entries.length, 2)
    assert.equal(entries[0].fields.title, "One")
    assert.ok(errors.length === 2 && errors.every((e) => e.warning))
  }],
  ["unclosed brace at the end of the file", () => {
    const { errors } = parseBib(`@article{a, title = {Open`)
    assert.equal(errors.length, 1)
    assert.match(errors[0].message, /unclosed "\{" \(opened on line 1\)/)
  }],
  ["text without entries is an error in BibTeX mode", () => {
    assert.match(parseBib("Brown, T. (2020). A paper.").errors[0].message, /no entries found/)
    assert.deepEqual(parseBib("   ").errors, [])
  }],
  ["LaTeX accents, commands and dashes become plain text", () => {
    assert.equal(latexToText(`M{\\"u}ller and Gonz\\'{a}lez \\& Co.: {\\em Caf\\'e} -- \\textit{na\\"ive} 50\\% \\ss`), "Müller and González & Co.: Café – naïve 50% ß")
    assert.equal(latexToText(`{\\c{c}}a~va---{IoT}`), "ça va—IoT")
  }],
  ["names: both orders, braces keep corporate names, others → et al.", () => {
    assert.deepEqual(splitNames("Donenfeld, Jason A. and Tom B. Brown and {World Health Organization} and others"), ["J. A. Donenfeld", "T. B. Brown", "World Health Organization", "et al."])
    assert.deepEqual(splitNames("{Barnes and Noble}"), ["Barnes and Noble"])
  }],
  ["BibTeX is recognised by its first line", () => {
    assert.equal(looksLikeBib("% comment\n@article{a, title={x}}"), true)
    assert.equal(looksLikeBib("Brown, T. (2020). @ symbol in text."), false)
  }],
  ["text mode: the real 56-reference list has no suspicious lines", () => {
    const text = readFileSync(new URL("./fixtures/web-heavy-references.txt", import.meta.url), "utf8")
    assert.deepEqual(prepareInput(text, "text").suspicious, [])
  }],
  ["text mode: wrapped references are spotted", () => {
    assert.deepEqual(suspiciousLines(["[1] A. Author, “A long title that goes", "on over two lines,” Journal, 2020.", "[2] B. Author, “Other,” 2021."]), [2])
    assert.deepEqual(suspiciousLines(["Brown, T. (2020). Language models are few-shot learners. NeurIPS.", "Advances in Neural", "learning (pp. 1–9)."]), [2, 3])
  }],
]

let failed = 0
for (const [name, fn] of tests) {
  try {
    fn()
    console.log(`✓ ${name}`)
  } catch (e) {
    failed++
    console.log(`✗ ${name}\n  ${(e as Error).message.split("\n").join("\n  ")}`)
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`)
process.exit(failed ? 1 : 0)
