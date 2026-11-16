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
