/**
 * MOCK DATA
 * ---------------------------------------------------------------------------
 * Shaped like an OpenAlex `GET /works/{doi}` response (https://developers.openalex.org),
 * enriched with fields from the Semantic Scholar Graph API (`/graph/v1/paper/DOI:{doi}`)
 * under `_semantic_scholar`, plus our own derived fields under `_sourcecheck`.
 *
 * Why these APIs:
 *  - OpenAlex: free, open; gives citation count, FWCI, citation percentile,
 *    retraction flag (Retraction Watch), venue type, open access, DOAJ / CWTS "core" flags.
 *  - Semantic Scholar: influentialCitationCount, publicationTypes, TLDR.
 *  - Crossref: publisher metadata (ACM has no public metadata API; its records live in Crossref).
 *
 * Citation numbers below are illustrative, NOT real lookups.
 * Entries 10 and 11 are fictional on purpose to show amber/red cases.
 */

export type SourceType = "journal" | "conference" | "repository" | "book series" | "ebook platform"

export interface OpenAlexWork {
  id: string
  doi: string | null
  display_name: string
  publication_year: number
  type: "article" | "preprint" | "book-chapter" | "review"
  authorships: { author_position: "first" | "middle" | "last"; author: { display_name: string } }[]
  primary_location: {
    version: "publishedVersion" | "submittedVersion" | "acceptedVersion"
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
  _semantic_scholar: {
    paperId: string
    citationCount: number
    influentialCitationCount: number
    publicationTypes: string[]
    venue: string
    tldr: string | null
  }
  _sourcecheck: {
    /** cosine similarity between the reference's abstract and the user's context (0..1) */
    relevance_to_context: number
    /** the raw reference string as parsed from the user's paste */
    raw_reference: string
    /** concepts matched against the user's context, used for the Webster & Watson matrix */
    concepts: string[]
  }
}

function years(start: number, total: number, curve: "rising" | "flat" | "falling" = "rising") {
  const out: { year: number; cited_by_count: number }[] = []
  const n = 2026 - start + 1
  const weights = Array.from({ length: n }, (_, i) => (curve === "rising" ? i + 1 : curve === "falling" ? n - i : 1))
  const sum = weights.reduce((a, b) => a + b, 0)
  weights.forEach((w, i) => out.push({ year: start + i, cited_by_count: Math.round((w / sum) * total) }))
  return out.reverse()
}

const a = (...names: string[]) =>
  names.map((n, i) => ({
    author_position: (i === 0 ? "first" : i === names.length - 1 ? "last" : "middle") as "first" | "middle" | "last",
    author: { display_name: n },
  }))

export const CONCEPTS = [
  "Prompting techniques",
  "Instruction tuning / RLHF",
  "Evaluation of LLM output",
  "Human-centered design",
  "Business innovation",
  "Reasoning & agents",
] as const

export const mockWorks: OpenAlexWork[] = [
  {
    id: "https://openalex.org/W3030163527",
    doi: "https://doi.org/10.48550/arXiv.2005.14165",
    display_name: "Language Models are Few-Shot Learners",
    publication_year: 2020,
    type: "article",
    authorships: a("Tom B. Brown", "Benjamin Mann", "Nick Ryder", "Melanie Subbiah", "Dario Amodei"),
    primary_location: {
      version: "publishedVersion",
      source: { display_name: "Advances in Neural Information Processing Systems (NeurIPS)", type: "conference", host_organization_name: "Neural Information Processing Systems Foundation", issn_l: "1049-5258", is_core: true, is_in_doaj: false },
    },
    cited_by_count: 41250,
    fwci: 812.4,
    citation_normalized_percentile: { value: 0.9999, is_in_top_1_percent: true, is_in_top_10_percent: true },
    counts_by_year: years(2020, 41250),
    referenced_works_count: 146,
    is_retracted: false,
    open_access: { is_oa: true, oa_status: "green" },
    indexed_in: ["arxiv", "crossref"],
    topics: [{ display_name: "Natural Language Processing Techniques", score: 0.99 }, { display_name: "Topic Modeling", score: 0.97 }],
    _semantic_scholar: { paperId: "90abbc2cf38462b954ae1b772fac9532e2ccd8b0", citationCount: 39870, influentialCitationCount: 4610, publicationTypes: ["Conference"], venue: "Neural Information Processing Systems", tldr: "Scaling up language models greatly improves task-agnostic, few-shot performance." },
    _sourcecheck: { relevance_to_context: 0.82, raw_reference: "Brown, T. B., et al. (2020). Language models are few-shot learners. Advances in Neural Information Processing Systems, 33.", concepts: ["Prompting techniques"] },
  },
  {
    id: "https://openalex.org/W4226278401",
    doi: "https://doi.org/10.52202/068431-2011",
    display_name: "Training language models to follow instructions with human feedback",
    publication_year: 2022,
    type: "article",
    authorships: a("Long Ouyang", "Jeff Wu", "Xu Jiang", "Diogo Almeida", "Ryan Lowe"),
    primary_location: {
      version: "publishedVersion",
      source: { display_name: "Advances in Neural Information Processing Systems (NeurIPS)", type: "conference", host_organization_name: "Neural Information Processing Systems Foundation", issn_l: "1049-5258", is_core: true, is_in_doaj: false },
    },
    cited_by_count: 15430,
    fwci: 402.1,
    citation_normalized_percentile: { value: 0.9998, is_in_top_1_percent: true, is_in_top_10_percent: true },
    counts_by_year: years(2022, 15430),
    referenced_works_count: 83,
    is_retracted: false,
    open_access: { is_oa: true, oa_status: "green" },
    indexed_in: ["arxiv", "crossref"],
    topics: [{ display_name: "Natural Language Processing Techniques", score: 0.98 }, { display_name: "Reinforcement Learning in Robotics", score: 0.71 }],
    _semantic_scholar: { paperId: "d766bffc357127e0dc86dd69561d5aeb520d6f4c", citationCount: 14980, influentialCitationCount: 1720, publicationTypes: ["Conference"], venue: "Neural Information Processing Systems", tldr: "Fine-tuning with human feedback aligns language models with user intent." },
    _sourcecheck: { relevance_to_context: 0.64, raw_reference: "Ouyang, L., et al. (2022). Training language models to follow instructions with human feedback. Advances in Neural Information Processing Systems, 35.", concepts: ["Instruction tuning / RLHF", "Evaluation of LLM output"] },
  },
  {
    id: "https://openalex.org/W4377130745",
    doi: "https://doi.org/10.1145/3544548.3581388",
    display_name: "Why Johnny Can't Prompt: How Non-AI Experts Try (and Fail) to Design LLM Prompts",
    publication_year: 2023,
    type: "article",
    authorships: a("J.D. Zamfirescu-Pereira", "Richmond Y. Wong", "Bjoern Hartmann", "Qian Yang"),
    primary_location: {
      version: "publishedVersion",
      source: { display_name: "Proceedings of the 2023 CHI Conference on Human Factors in Computing Systems", type: "conference", host_organization_name: "Association for Computing Machinery", issn_l: null, is_core: true, is_in_doaj: false },
    },
    cited_by_count: 742,
    fwci: 64.8,
    citation_normalized_percentile: { value: 0.997, is_in_top_1_percent: true, is_in_top_10_percent: true },
    counts_by_year: years(2023, 742),
    referenced_works_count: 71,
    is_retracted: false,
    open_access: { is_oa: true, oa_status: "gold" },
    indexed_in: ["crossref"],
    topics: [{ display_name: "Human-Computer Interaction", score: 0.96 }, { display_name: "Natural Language Processing Techniques", score: 0.88 }],
    _semantic_scholar: { paperId: "4c2e4bfa4e2b8c1d3f1e4c6f1b2d9a0e7f5a3c11", citationCount: 715, influentialCitationCount: 48, publicationTypes: ["Book", "JournalArticle", "Conference"], venue: "International Conference on Human Factors in Computing Systems", tldr: "Non-experts prompt opportunistically and struggle to generalize from failures." },
    _sourcecheck: { relevance_to_context: 0.91, raw_reference: "Zamfirescu-Pereira, J. D., et al. (2023). Why Johnny can't prompt: How non-AI experts try (and fail) to design LLM prompts. Proceedings of the 2023 CHI Conference on Human Factors in Computing Systems.", concepts: ["Prompting techniques", "Human-centered design", "Evaluation of LLM output"] },
  },
  {
    id: "https://openalex.org/W4320000123",
    doi: "https://doi.org/10.48550/arXiv.2302.11382",
    display_name: "A Prompt Pattern Catalog to Enhance Prompt Engineering with ChatGPT",
    publication_year: 2023,
    type: "preprint",
    authorships: a("Jules White", "Quchen Fu", "Sam Hays", "Michael Sandborn", "Douglas C. Schmidt"),
    primary_location: {
      version: "submittedVersion",
      source: { display_name: "arXiv (Cornell University)", type: "repository", host_organization_name: "Cornell University", issn_l: null, is_core: false, is_in_doaj: false },
    },
    cited_by_count: 1380,
    fwci: 98.3,
    citation_normalized_percentile: { value: 0.998, is_in_top_1_percent: true, is_in_top_10_percent: true },
    counts_by_year: years(2023, 1380, "flat"),
    referenced_works_count: 32,
    is_retracted: false,
    open_access: { is_oa: true, oa_status: "green" },
    indexed_in: ["arxiv"],
    topics: [{ display_name: "Natural Language Processing Techniques", score: 0.95 }, { display_name: "Software Engineering Research", score: 0.74 }],
    _semantic_scholar: { paperId: "08b85bce712168998004ee80ce4e475390413c74", citationCount: 1312, influentialCitationCount: 76, publicationTypes: ["JournalArticle"], venue: "arXiv.org", tldr: "A catalog of reusable prompt patterns, analogous to software design patterns." },
    _sourcecheck: { relevance_to_context: 0.93, raw_reference: "White, J., et al. (2023). A prompt pattern catalog to enhance prompt engineering with ChatGPT. arXiv.", concepts: ["Prompting techniques"] },
  },
  {
    id: "https://openalex.org/W4319000456",
    doi: "https://doi.org/10.48550/arXiv.2303.17651",
    display_name: "Self-Refine: Iterative Refinement with Self-Feedback",
    publication_year: 2023,
    type: "article",
    authorships: a("Aman Madaan", "Niket Tandon", "Prakhar Gupta", "Peter Clark"),
    primary_location: {
      version: "publishedVersion",
      source: { display_name: "Advances in Neural Information Processing Systems (NeurIPS)", type: "conference", host_organization_name: "Neural Information Processing Systems Foundation", issn_l: "1049-5258", is_core: true, is_in_doaj: false },
    },
    cited_by_count: 1610,
    fwci: 88.2,
    citation_normalized_percentile: { value: 0.998, is_in_top_1_percent: true, is_in_top_10_percent: true },
    counts_by_year: years(2023, 1610),
    referenced_works_count: 64,
    is_retracted: false,
    open_access: { is_oa: true, oa_status: "green" },
    indexed_in: ["arxiv", "crossref"],
    topics: [{ display_name: "Natural Language Processing Techniques", score: 0.97 }],
    _semantic_scholar: { paperId: "3aaf6a2cbad5850ad81ab5c163599cb3d523436f", citationCount: 1544, influentialCitationCount: 162, publicationTypes: ["Conference"], venue: "Neural Information Processing Systems", tldr: "An LLM can improve its own output by generating feedback and refining." },
    _sourcecheck: { relevance_to_context: 0.72, raw_reference: "Madaan, A., et al. (2023). Self-refine: Iterative refinement with self-feedback. Advances in Neural Information Processing Systems, 36.", concepts: ["Prompting techniques", "Evaluation of LLM output"] },
  },
  {
    id: "https://openalex.org/W4318000789",
    doi: null,
    display_name: "ReAct: Synergizing Reasoning and Acting in Language Models",
    publication_year: 2023,
    type: "article",
    authorships: a("Shunyu Yao", "Jeffrey Zhao", "Dian Yu", "Nan Du", "Yuan Cao"),
    primary_location: {
      version: "publishedVersion",
      source: { display_name: "International Conference on Learning Representations (ICLR)", type: "conference", host_organization_name: "OpenReview", issn_l: null, is_core: false, is_in_doaj: false },
    },
    cited_by_count: 3120,
    fwci: 141.7,
    citation_normalized_percentile: { value: 0.999, is_in_top_1_percent: true, is_in_top_10_percent: true },
    counts_by_year: years(2023, 3120),
    referenced_works_count: 58,
    is_retracted: false,
    open_access: { is_oa: true, oa_status: "green" },
    indexed_in: ["arxiv"],
    topics: [{ display_name: "Natural Language Processing Techniques", score: 0.96 }, { display_name: "Multi-Agent Systems", score: 0.69 }],
    _semantic_scholar: { paperId: "99832586d55f540f603637e458a292406a0ed75d", citationCount: 3015, influentialCitationCount: 402, publicationTypes: ["Conference"], venue: "International Conference on Learning Representations", tldr: "Interleaving reasoning traces and actions improves LLM task solving." },
    _sourcecheck: { relevance_to_context: 0.58, raw_reference: "Yao, S., et al. (2023). ReAct: Synergizing reasoning and acting in language models. International Conference on Learning Representations.", concepts: ["Prompting techniques", "Reasoning & agents"] },
  },
  {
    id: "https://openalex.org/W4396000222",
    doi: "https://doi.org/10.48550/arXiv.2406.06608",
    display_name: "The Prompt Report: A Systematic Survey of Prompt Engineering Techniques",
    publication_year: 2024,
    type: "preprint",
    authorships: a("Sander Schulhoff", "Michael Ilie", "Nishant Balepur", "Philip Resnik"),
    primary_location: {
      version: "submittedVersion",
      source: { display_name: "arXiv (Cornell University)", type: "repository", host_organization_name: "Cornell University", issn_l: null, is_core: false, is_in_doaj: false },
    },
    cited_by_count: 412,
    fwci: 37.5,
    citation_normalized_percentile: { value: 0.992, is_in_top_1_percent: true, is_in_top_10_percent: true },
    counts_by_year: years(2024, 412),
    referenced_works_count: 1565,
    is_retracted: false,
    open_access: { is_oa: true, oa_status: "green" },
    indexed_in: ["arxiv"],
    topics: [{ display_name: "Natural Language Processing Techniques", score: 0.99 }],
    _semantic_scholar: { paperId: "a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5", citationCount: 398, influentialCitationCount: 31, publicationTypes: ["JournalArticle", "Review"], venue: "arXiv.org", tldr: "A taxonomy of 58 text-based prompting techniques and a shared vocabulary." },
    _sourcecheck: { relevance_to_context: 0.95, raw_reference: "Schulhoff, S., et al. (2024). The prompt report: A systematic survey of prompt engineering techniques. arXiv.", concepts: ["Prompting techniques", "Evaluation of LLM output"] },
  },
  {
    id: "https://openalex.org/W4395000333",
    doi: "https://doi.org/10.1016/j.bushor.2024.04.014",
    display_name: "Innovating by prompting: How to facilitate innovation in the age of generative AI",
    publication_year: 2024,
    type: "article",
    authorships: a("Leif Sundberg", "Jonny Holmström"),
    primary_location: {
      version: "publishedVersion",
      source: { display_name: "Business Horizons", type: "journal", host_organization_name: "Elsevier BV", issn_l: "0007-6813", is_core: true, is_in_doaj: false },
    },
    cited_by_count: 118,
    fwci: 14.2,
    citation_normalized_percentile: { value: 0.981, is_in_top_1_percent: false, is_in_top_10_percent: true },
    counts_by_year: years(2024, 118),
    referenced_works_count: 41,
    is_retracted: false,
    open_access: { is_oa: true, oa_status: "hybrid" },
    indexed_in: ["crossref", "scopus"],
    topics: [{ display_name: "Innovation and Knowledge Management", score: 0.93 }, { display_name: "Artificial Intelligence in Business", score: 0.91 }],
    _semantic_scholar: { paperId: "b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0", citationCount: 109, influentialCitationCount: 6, publicationTypes: ["JournalArticle"], venue: "Business Horizons", tldr: "Prompting as an organizational capability for innovation." },
    _sourcecheck: { relevance_to_context: 0.77, raw_reference: "Sundberg, L., & Holmström, J. (2024). Innovating by prompting: How to facilitate innovation in the age of generative AI. Business Horizons, 67(5), 561–570.", concepts: ["Business innovation", "Prompting techniques"] },
  },
  {
    id: "https://openalex.org/W4317000444",
    doi: "https://doi.org/10.48550/arXiv.2301.07597",
    display_name: "How Close is ChatGPT to Human Experts? Comparison Corpus, Evaluation, and Detection",
    publication_year: 2023,
    type: "preprint",
    authorships: a("Biyang Guo", "Xin Zhang", "Ziyuan Wang", "Yupeng Wu"),
    primary_location: {
      version: "submittedVersion",
      source: { display_name: "arXiv (Cornell University)", type: "repository", host_organization_name: "Cornell University", issn_l: null, is_core: false, is_in_doaj: false },
    },
    cited_by_count: 905,
    fwci: 52.6,
    citation_normalized_percentile: { value: 0.996, is_in_top_1_percent: true, is_in_top_10_percent: true },
    counts_by_year: years(2023, 905, "falling"),
    referenced_works_count: 47,
    is_retracted: false,
    open_access: { is_oa: true, oa_status: "green" },
    indexed_in: ["arxiv"],
    topics: [{ display_name: "Natural Language Processing Techniques", score: 0.97 }],
    _semantic_scholar: { paperId: "c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0", citationCount: 871, influentialCitationCount: 61, publicationTypes: ["JournalArticle"], venue: "arXiv.org", tldr: "The HC3 corpus compares ChatGPT and human expert answers." },
    _sourcecheck: { relevance_to_context: 0.48, raw_reference: "Guo, B., et al. (2023). How close is ChatGPT to human experts? Comparison corpus, evaluation, and detection. arXiv.", concepts: ["Evaluation of LLM output"] },
  },
  {
    id: "https://openalex.org/W9000000010",
    doi: "https://doi.org/10.99999/ijaairt.2025.0412",
    display_name: "Ten Prompt Secrets That Boost Student Productivity by 500%",
    publication_year: 2025,
    type: "article",
    authorships: a("A. Example", "B. Placeholder"),
    primary_location: {
      version: "publishedVersion",
      source: { display_name: "International Journal of Advanced AI Research and Trends", type: "journal", host_organization_name: null, issn_l: null, is_core: false, is_in_doaj: false },
    },
    cited_by_count: 2,
    fwci: 0.08,
    citation_normalized_percentile: { value: 0.21, is_in_top_1_percent: false, is_in_top_10_percent: false },
    counts_by_year: years(2025, 2, "flat"),
    referenced_works_count: 6,
    is_retracted: false,
    open_access: { is_oa: true, oa_status: "gold" },
    indexed_in: ["crossref"],
    topics: [{ display_name: "Educational Technology", score: 0.62 }],
    _semantic_scholar: { paperId: "f0e1d2c3b4a5968778695a4b3c2d1e0f9a8b7c6d", citationCount: 1, influentialCitationCount: 0, publicationTypes: ["JournalArticle"], venue: "", tldr: null },
    _sourcecheck: { relevance_to_context: 0.55, raw_reference: "Example, A., & Placeholder, B. (2025). Ten prompt secrets that boost student productivity by 500%. International Journal of Advanced AI Research and Trends, 4(2), 1–9.", concepts: ["Prompting techniques", "Business innovation"] },
  },
  {
    id: "https://openalex.org/W9000000011",
    doi: "https://doi.org/10.99999/jcis.2023.0077",
    display_name: "Large Language Models Reliably Detect Fabricated Citations",
    publication_year: 2023,
    type: "article",
    authorships: a("C. Mockauthor", "D. Fictional", "E. Sample"),
    primary_location: {
      version: "publishedVersion",
      source: { display_name: "Journal of Computational Information Studies", type: "journal", host_organization_name: "Example Academic Press", issn_l: "0000-0000", is_core: false, is_in_doaj: true },
    },
    cited_by_count: 57,
    fwci: 2.1,
    citation_normalized_percentile: { value: 0.74, is_in_top_1_percent: false, is_in_top_10_percent: false },
    counts_by_year: years(2023, 57, "falling"),
    referenced_works_count: 29,
    is_retracted: true,
    open_access: { is_oa: true, oa_status: "gold" },
    indexed_in: ["crossref", "doaj"],
    topics: [{ display_name: "Scientific Integrity", score: 0.81 }],
    _semantic_scholar: { paperId: "e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0", citationCount: 54, influentialCitationCount: 3, publicationTypes: ["JournalArticle"], venue: "Journal of Computational Information Studies", tldr: null },
    _sourcecheck: { relevance_to_context: 0.86, raw_reference: "Mockauthor, C., Fictional, D., & Sample, E. (2023). Large language models reliably detect fabricated citations. Journal of Computational Information Studies, 12(3), 201–219.", concepts: ["Evaluation of LLM output", "Human-centered design"] },
  },
]

export const SAMPLE_REFERENCES = mockWorks.map((w) => w._sourcecheck.raw_reference).join("\n")

export const SAMPLE_CONTEXT = `How do university students search for and verify academic sources when writing with generative AI? This paper investigates prompt engineering techniques for an assistant that evaluates the credibility of references in student papers. Following a human-centered prompting approach, we interview students and lecturers, derive quality criteria for sources (e.g., peer review, citation impact, relevance), and evaluate LLM-generated assessments against an expert gold standard.`
