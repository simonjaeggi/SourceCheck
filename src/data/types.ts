/**
 * A source as the app uses it: an OpenAlex /works record (only the fields we read),
 * plus SourceCheck's own fields under `_sourcecheck`. Built by server/openalex.ts.
 */
/** Facts you can enter for a source, the same rows as the expert form. All optional except a title for manual sources. */
export type SourceDetails = Partial<Record<"title" | "use" | "source_type" | "venue" | "authors" | "year" | "peer_review" | "venue_metric" | "citations" | "link" | "abstract", string>>

export type SourceType = "journal" | "conference" | "repository" | "book series" | "ebook platform" | (string & {})

export interface OpenAlexWork {
  id: string
  doi: string | null
  display_name: string
  publication_year: number
  /** OpenAlex work type; live data also has e.g. "conference-paper", "dataset", "book" */
  type: "article" | "preprint" | "book-chapter" | "review" | (string & {})
  authorships: {
    author_position: "first" | "middle" | "last" | (string & {})
    author: { id?: string | null; display_name: string }
    institutions?: { display_name: string }[]
  }[]
  primary_location: {
    version: "publishedVersion" | "submittedVersion" | "acceptedVersion" | null
    source: {
      display_name: string
      type: SourceType
      host_organization_name: string | null
      issn_l: string | null
      is_core: boolean
      is_in_doaj: boolean
    } | null
  }
  cited_by_count: number
  fwci: number | null
  citation_normalized_percentile: { value: number; is_in_top_1_percent: boolean; is_in_top_10_percent: boolean } | null
  counts_by_year: { year: number; cited_by_count: number }[]
  referenced_works_count: number
  is_retracted: boolean
  open_access: { is_oa: boolean; oa_status: "gold" | "green" | "hybrid" | "bronze" | "diamond" | "closed" }
  indexed_in: string[]
  topics: { display_name: string; score: number }[]
  _sourcecheck: {
    /** highest h-index among the authors (OpenAlex `/authors/{id}` summary_stats.h_index) */
    max_author_h_index: number | null
    /** the raw reference string as parsed from the user's paste */
    raw_reference: string
    /** position of that reference in the pasted list (0-based), for "Input order" */
    input_index?: number
    /** where this record came from: OpenAlex, or details you entered for a source OpenAlex does not have */
    origin: "openalex" | "manual"
    /** facts you entered; for an OpenAlex record they replace OpenAlex's value for that fact */
    details?: SourceDetails
    /** for a manual source: the unmatched entry it was made from, so removing the details restores it */
    unmatched?: { reason: string; web?: { title: string; url: string | null; site: string | null; year: number | null; accessed: number | null } }
    /** how the reference was matched to the OpenAlex record */
    match?: {
      method: "doi" | "title_search"
      /** "confirmed": an uncertain match the user accepted */
      confidence: "exact" | "likely" | "uncertain" | "confirmed"
      /** what agreed besides the title: "author", "year", "venue" */
      signals?: string[]
    }
    /** abstract rebuilt from OpenAlex abstract_inverted_index, shortened */
    abstract?: string | null
    /** per author: last known institution and h-index (OpenAlex /authors) */
    author_details?: { name: string; institution: string | null; h_index: number | null }[]
  }
}
