/**
 * Example input for the "Load example" button: a reference list (two of the entries are
 * made up on purpose, to show what an unmatched reference looks like) and a thesis context.
 */
export const SAMPLE_REFERENCES = [
  "Brown, T. B., et al. (2020). Language models are few-shot learners. Advances in Neural Information Processing Systems, 33.",
  "Ouyang, L., et al. (2022). Training language models to follow instructions with human feedback. Advances in Neural Information Processing Systems, 35.",
  "Zamfirescu-Pereira, J. D., et al. (2023). Why Johnny can't prompt: How non-AI experts try (and fail) to design LLM prompts. Proceedings of the 2023 CHI Conference on Human Factors in Computing Systems.",
  "White, J., et al. (2023). A prompt pattern catalog to enhance prompt engineering with ChatGPT. arXiv.",
  "Madaan, A., et al. (2023). Self-refine: Iterative refinement with self-feedback. Advances in Neural Information Processing Systems, 36.",
  "Yao, S., et al. (2023). ReAct: Synergizing reasoning and acting in language models. International Conference on Learning Representations.",
  "Schulhoff, S., et al. (2024). The prompt report: A systematic survey of prompt engineering techniques. arXiv.",
  "Sundberg, L., & Holmström, J. (2024). Innovating by prompting: How to facilitate innovation in the age of generative AI. Business Horizons, 67(5), 561–570.",
  "Guo, B., et al. (2023). How close is ChatGPT to human experts? Comparison corpus, evaluation, and detection. arXiv.",
  "Example, A., & Placeholder, B. (2025). Ten prompt secrets that boost student productivity by 500%. International Journal of Advanced AI Research and Trends, 4(2), 1–9.",
  "Placeholder, C., Fictional, D., & Sample, E. (2023). Large language models reliably detect fabricated citations. Journal of Computational Information Studies, 12(3), 201–219.",
].join("\n")

export const SAMPLE_CONTEXT = `How do university students search for and verify academic sources when writing with generative AI? This paper investigates prompt engineering techniques for an assistant that evaluates the credibility of references in student papers. Following a human-centered prompting approach, we interview students and lecturers, derive quality criteria for sources (e.g., peer review, citation impact, relevance), and evaluate LLM-generated assessments against an expert gold standard.`

/**
 * The ten sources of the expert gold standard (Source_Assessment_Form_v2, as of
 * 10 November 2026): five from each of two master's theses. Each thesis has its own
 * research question, so each is its own example; the references are copied exactly as
 * given in the theses' bibliographies, mistakes included.
 */
export const GOLD_THESIS_A_REFERENCES = [
  "Haurum, K. R., Ma, R., & Long, W. (2024). Real Estate with AI: An agent based on LangChain. Procedia Computer Science, 242, 1082–1088. https://doi.org/10.1016/j.procs.2024.08.199",
  "Brynjolfsson, E., Li, D., & Raymond, L. R. (2023). Generative AI at Work (Working Paper 31161). National Bureau of Economic Research. https://doi.org/10.3386/w31161",
  "Hevner, A. R., March, S. T., Park, J., & Ram, S. (2004). Design Science in Information Systems Research. MIS Quarterly, 28(1), 75–105. https://doi.org/10.2307/25148625",
  "Alimi, A., Grace, C., Oladele, S., & Mia, J. (2024). Data-Driven Decision-Making: Challenges and Opportunities in Business Analytic.",
  "Bruckhaus, T. (2024). RAG Does Not Work for Enterprises (arXiv:2406.04369). arXiv. https://doi.org/10.48550/arXiv.2406.04369",
].join("\n")

export const GOLD_THESIS_A_CONTEXT = `Master's thesis, MSc in Business Information Systems, Swiss university of applied sciences, 2025, in German.
Topic: Integration und Einsatz eines KI-Agenten für datenbasierte Entscheidungen in kleinen Unternehmen (Integration and use of an AI agent for data-based decisions in small businesses).
Research question: How can an AI agent support data-based decision-making and existing business processes in small businesses, and what challenges arise in practical implementation?`

export const GOLD_THESIS_B_REFERENCES = [
  "Felten, E., Raj, M., & Seamans, R. (2021). Occupational, industry, and geographic exposure to artificial intelligence: A novel dataset and its potential uses. Strategic Management Journal, 42(12), 2195-2217.",
  "Swiss Banking Association and The Boston Consulting Group. (2011). Banking im Wandel – Zukunftsperspektiven für Banken in der Schweiz. Basel.",
  "Redstone Search. (2024, 11 26). Redstone Search. Retrieved from What Are The Different Roles Available In Private Banking?: https://redstonesearch.com/what-are-different-roles-available-in-private-banking/",
  "Eloundou, T., Manning, S., Mishkin, P., & Rock, D. (2024, 06 21). GPTs are GPTs: An Early Look at the Labor Market Impact Potential of Large LanguageModels. Science, 384(6702), 1306-1308.",
  "O*NET. (n.d.). O*NET Resource Center. Retrieved 04 2025, from About O*NET: https://www.onetcenter.org/overview.html",
].join("\n")

export const GOLD_THESIS_B_CONTEXT = `Master's thesis, MSc in Banking and Finance, Swiss university of applied sciences, 2025, in English.
Topic: The AI Exposure of Swiss Banking Employees. A replication of Felten et al.'s 2021 methodology applied to a Swiss context.
Research question: What is the AI-Exposure of Swiss Private Banking Employees? The focus lies on Relationship Managers and Back-Office Employees working in the Private Banking segment of Swiss banks.`

export type Example = { id: string; label: string; description: string; references: string; context: string }

export const EXAMPLES: Example[] = [
  { id: "thesis-a", label: "Gold standard: Thesis A", description: "Sources 1–5, AI agents in small businesses", references: GOLD_THESIS_A_REFERENCES, context: GOLD_THESIS_A_CONTEXT },
  { id: "thesis-b", label: "Gold standard: Thesis B", description: "Sources 6–10, AI exposure in Swiss banking", references: GOLD_THESIS_B_REFERENCES, context: GOLD_THESIS_B_CONTEXT },
  { id: "demo", label: "Demo list", description: "11 prompt-engineering references, 2 of them made up", references: SAMPLE_REFERENCES, context: SAMPLE_CONTEXT },
]
