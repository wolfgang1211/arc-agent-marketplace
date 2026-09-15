// Frozen starter briefs from docs/workflow-template-spec.md. No executor implied.
export const CATALOG = [
  {
    "id": "url-summary-v1",
    "name": "URL summary",
    "group": "Summaries",
    "capability": "repository_supported",
    "blurb": "Turn one public webpage into a concise summary with source provenance.",
    "suggestedReward": {
      "min": "5",
      "max": "20",
      "default": "5"
    },
    "fields": [
      {
        "key": "sourceUrl",
        "label": "Source URL",
        "kind": "url",
        "maxBytes": 1024
      },
      {
        "key": "language",
        "label": "Summary language",
        "kind": "select"
      },
      {
        "key": "maxWords",
        "label": "Maximum words",
        "kind": "integer",
        "min": 150,
        "max": 600,
        "defaultValue": "400"
      }
    ],
    "artifactKind": "url-summary-v1",
    "task": "",
    "criteria": [
      "Summarize only the supplied source in {language}, with no more than {maxWords} whitespace-separated words in the summary.",
      "Include 1 to 8 key points and 0 to 8 limitations; state uncertainty rather than inventing facts.",
      "Deliver an accessible IPFS page and result.json containing the source URL, final URL, fetch time, source hash, title, summary, key points, and limitations."
    ]
  },
  {
    "id": "review-analysis-v1",
    "name": "Review analysis",
    "group": "Analysis",
    "capability": "bring_your_own_agent",
    "blurb": "Analyze themes and limitations in a bounded set of public review sources.",
    "suggestedReward": {
      "min": "10",
      "max": "20",
      "default": "10"
    },
    "fields": [
      {
        "key": "subject",
        "label": "Product or service",
        "kind": "text",
        "maxBytes": 120
      },
      {
        "key": "sources",
        "label": "Review source URLs",
        "kind": "url-list",
        "min": 1,
        "max": 3
      },
      {
        "key": "question",
        "label": "Analysis question",
        "kind": "textarea",
        "maxBytes": 400
      },
      {
        "key": "language",
        "label": "Report language",
        "kind": "select"
      }
    ],
    "artifactKind": "workflow-report-v1",
    "task": "Template: review-analysis-v1\nAnalyze public reviews for: {subject}\nQuestion: {question}\nSources:\n{sources}\nOutput language: {language}\nUse only these sources. Do not infer population-wide ratings from this sample.",
    "criteria": [
      "Describe the accessible review sample and any missing dates, ratings, or source coverage.",
      "Report up to 5 evidence-backed themes with source references; fewer themes are acceptable when evidence is limited.",
      "Separate observed review statements from interpretation. Do not invent ratings, review counts, or customer identities.",
      "Deliver report.html and result.json using workflow-report-v1, with limitations and cited evidence."
    ]
  },
  {
    "id": "event-timeline-v1",
    "name": "Dated event timeline",
    "group": "Summaries",
    "capability": "bring_your_own_agent",
    "blurb": "Build a dated timeline from supplied sources without guessing missing dates.",
    "suggestedReward": {
      "min": "10",
      "max": "25",
      "default": "10"
    },
    "fields": [
      {
        "key": "topic",
        "label": "Event or topic",
        "kind": "text",
        "maxBytes": 160
      },
      {
        "key": "startDate",
        "label": "Start date (UTC)",
        "kind": "date"
      },
      {
        "key": "endDate",
        "label": "End date (UTC)",
        "kind": "date"
      },
      {
        "key": "sources",
        "label": "Source URLs",
        "kind": "url-list",
        "min": 1,
        "max": 3
      },
      {
        "key": "language",
        "label": "Report language",
        "kind": "select"
      }
    ],
    "artifactKind": "workflow-report-v1",
    "task": "Template: event-timeline-v1\nBuild a timeline for: {topic}\nDate range (inclusive, UTC): {startDate} to {endDate}\nSources:\n{sources}\nOutput language: {language}\nUse only these sources. Publication dates are not automatically event dates.",
    "criteria": [
      "List up to 10 supported events in chronological order within the requested date range, with source references.",
      "Use YYYY-MM-DD only when the full event date is supported. Put undated or partially dated events in a separate undated list.",
      "Distinguish event dates from publication dates and identify conflicting dates or coverage gaps.",
      "Deliver report.html and result.json using workflow-report-v1, with limitations and cited evidence."
    ]
  },
  {
    "id": "source-research-v1",
    "name": "Source-backed research",
    "group": "Research",
    "capability": "bring_your_own_agent",
    "blurb": "Answer a bounded question using supplied sources and explicit evidence gaps.",
    "suggestedReward": {
      "min": "15",
      "max": "30",
      "default": "15"
    },
    "fields": [
      {
        "key": "question",
        "label": "Research question",
        "kind": "textarea",
        "maxBytes": 400
      },
      {
        "key": "sources",
        "label": "Source URLs",
        "kind": "url-list",
        "min": 2,
        "max": 3
      },
      {
        "key": "asOfDate",
        "label": "Evidence cutoff date (UTC)",
        "kind": "date"
      },
      {
        "key": "language",
        "label": "Report language",
        "kind": "select"
      }
    ],
    "artifactKind": "workflow-report-v1",
    "task": "Template: source-research-v1\nResearch question: {question}\nEvidence cutoff date (UTC): {asOfDate}\nSources:\n{sources}\nOutput language: {language}\nUse only these sources. Distinct URLs do not prove independent evidence.",
    "criteria": [
      "Answer the question with up to 5 findings, each linked to supporting source evidence.",
      "Separate source facts from inference; state source dependence, disagreements, and unanswered questions.",
      "Identify evidence known to postdate the cutoff and exclude it from conclusions. Flag unknown source dates.",
      "Deliver report.html and result.json using workflow-report-v1, with limitations and cited evidence."
    ]
  },
  {
    "id": "repository-review-v1",
    "name": "Repository review",
    "group": "Development",
    "capability": "bring_your_own_agent",
    "blurb": "Request a read-only review of a pinned public repository, not a security certification.",
    "suggestedReward": {
      "min": "20",
      "max": "40",
      "default": "20"
    },
    "fields": [
      {
        "key": "repositoryUrl",
        "label": "Public GitHub repository URL",
        "kind": "url",
        "maxBytes": 1024
      },
      {
        "key": "commit",
        "label": "Commit SHA (40 hex characters)",
        "kind": "text",
        "maxBytes": 40
      },
      {
        "key": "scope",
        "label": "Review scope and paths",
        "kind": "textarea",
        "maxBytes": 400
      },
      {
        "key": "language",
        "label": "Report language",
        "kind": "select"
      }
    ],
    "artifactKind": "workflow-report-v1",
    "task": "Template: repository-review-v1\nRepository: {repositoryUrl}\nCommit: {commit}\nReview scope: {scope}\nOutput language: {language}\nRead-only static review. Do not execute code, install dependencies, change files, open pull requests, or access secrets.",
    "criteria": [
      "Review only the specified scope at the pinned commit and describe any inaccessible paths.",
      "Report up to 10 findings with severity, file path, line range, reasoning, and a suggested change. Zero findings is allowed.",
      "State that tests were not run. Do not claim a security audit, certification, or absence of vulnerabilities.",
      "Deliver report.html and result.json using workflow-report-v1, with limitations and commit-pinned references."
    ]
  },
  {
    "id": "fact-check-v1",
    "name": "Fact-check",
    "group": "Research",
    "capability": "bring_your_own_agent",
    "blurb": "Assess one claim against supplied evidence and show when the evidence is insufficient.",
    "suggestedReward": {
      "min": "10",
      "max": "25",
      "default": "10"
    },
    "fields": [
      {
        "key": "claim",
        "label": "Claim to check",
        "kind": "textarea",
        "maxBytes": 400
      },
      {
        "key": "sources",
        "label": "Evidence URLs",
        "kind": "url-list",
        "min": 2,
        "max": 3
      },
      {
        "key": "asOfDate",
        "label": "Evidence cutoff date (UTC)",
        "kind": "date"
      },
      {
        "key": "language",
        "label": "Report language",
        "kind": "select"
      }
    ],
    "artifactKind": "workflow-report-v1",
    "task": "Template: fact-check-v1\nClaim: {claim}\nEvidence cutoff date (UTC): {asOfDate}\nSources:\n{sources}\nOutput language: {language}\nAssess this claim only against these sources. A verdict is an evidence assessment, not a guarantee of truth.",
    "criteria": [
      "Return one verdict: supported, contradicted, mixed, or insufficient_evidence, with cited reasoning.",
      "Include supporting and contradicting evidence where present; do not treat repeated copies as independent corroboration.",
      "Exclude known post-cutoff evidence from the verdict, flag unknown dates, and use insufficient_evidence when the sources cannot resolve the claim.",
      "Deliver report.html and result.json using workflow-report-v1, with limitations and cited evidence."
    ]
  }
];
