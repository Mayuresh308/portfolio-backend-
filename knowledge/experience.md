# Professional Experience — Mayuresh Devadkar

## Operations Associate (Product & Engineering Operations) — Seconds
Remote · Dec 2025 – Sep 2026

Worked across three AI products: an AI lead-generation platform, an AI meeting platform, and an AI timezone browser extension. Drafted and maintained the Product Requirements Documents (PRDs) for all three. Used Figma and Lovable for UI/UX and frontend development across the products.

### AI lead-generation platform (signal-based outbound)
- Contributed to the core architecture connecting four inputs (company profile, signal context, target-company data, decision-maker details) into one personalized email-generation pipeline.
- Built the prompt-to-lead pipeline with LangChain and RAG: parsing user prompts into keywords, fetching candidate leads, running a RAG-based relevance comparison against the user's targeting, and surfacing only leads that passed.
- Owned the keyword-generation prompt end to end; when relevance testing showed poor results, rewrote and re-validated it until outputs met the relevance bar.
- Owned relevance-scoring design and testing across multiple iteration rounds, and helped define Tier 1/2/3 (High/Medium/Low) scoring used to qualify leads. Prompt iterations improved results from about 2/10 to 7/10 on a manually reviewed test sample (not a production-wide metric).
- Used structured outputs / function calling so email generation and relevance scoring returned fixed, machine-parseable formats that could be reliably scored and routed.
- Designed an LLM evaluation framework with LangSmith (datasets, experiment tracking, performance measurement), tracing inputs and outputs across each agent step.
- Fixed a duplicate-article bug where the same event from different publishers became separate leads: designed content-based unique keys per article so matching stories are grouped and distinct ones kept separate.
- Originated and implemented a multi-company agent structure (inspired by password-manager vaults): each agent scopes leads and signals to one company, so one account can run lead generation for several companies without data crossing over.
- Contributed to redesigning the email-body generation so outreach reads as specific and human, tied to the actual signal rather than templated filler.
- Tested lead-finding, bulk-outreach, and social-messaging agents beyond functional QA: checked whether leads were genuinely relevant, matched to the right company, and at the right seniority, and whether generated comments matched the user's targeting and voice.
- Identified a stronger news-data API, adopted for a reported ~10x improvement in data-fetching productivity, and researched alternative signal and data sources for the roadmap.
- Ran a weekly AI-assisted competitor analysis comparing competitor features and reviews against the platform to find improvements worth building.
- Built a tracking sheet for agent enrichment, drafted emails, and article extraction, giving the team real-time visibility into pipeline health.
- Joined beta-user meetings, turned feedback into structured summaries, and built a beta-feedback tracker (problems, questions, metrics) linking user feedback to the backlog.
- Contributed to the platform's APIs and data pipelines, and to defining workspace roles and permission logic.

### AI meeting platform (meeting intelligence)
- Contributed feature ideation, requirements, and validation testing across core capabilities: bot-free local recording and a meeting-bot mode (defined when each applies, e.g. meetings that block bots or overlapping meetings), speaker-aware transcripts, summaries, action items, decisions, searchable meeting memory with natural-language queries, a cross-app voice-to-text writing assistant, and automatic detection and one-click delivery of documents promised during meetings.
- Designed and built a one-to-one chat feature between meeting participants (previously only group-wide messages).
- Developed the application's UI/UX using Figma and Lovable, covering the core feature set end to end.
- Designed automation workflows on top of the platform: a third-party notetaker integration, a stakeholder-intelligence bot, and a rescheduling/cancellation flow.
- Drove internal adoption before it became a formal workstream, making it the team's default meeting-capture tool.

### AI timezone browser extension
- Contributed from the earliest LLM research stage: proposed a technical approach for hover-based timezone summarization and built an early prototype to validate it.
- Defined the core feature set: multiple timezones (one default plus up to five favorites), natural-language reminders ("after 5 min", "at 9am my time") with browser and Gmail notifications, an in-popup calendar, and a natural-language search for instant conversions.
- Designed handling for time mentions with no timezone: a dropdown to select the receiver's timezone so the conversion still resolves reliably.
- Designed, built, and tested the calendar pop-up end to end (UI/UX and logic), letting users view their schedule and join meetings without leaving the page.
- Owned granular cross-timezone QA across 5+ timezones, including daylight-saving and month-boundary transitions, ambiguous time mentions, and multi-block scheduling.
- Ran cross-browser and cross-platform testing (Slack, Gmail, Outlook, LinkedIn, Teams, Notion) and scoped mobile feasibility.
- Built a speech-to-text landing page as an SEO growth play, using competitor benchmarking to plan further organic-acquisition pages, and reviewed marketing-site design iterations.

### Operations and internal automation (company-wide)
- Built the company Knowledge Hub with n8n: a Google Sheet index of Google Drive files where employees ask in Slack and instantly get the right file link, plus an MVP Q&A agent and onboarding forms in Slack.
- Built an n8n + Slack leave-management automation: checks live leave balances, auto-approves sick leave when balance allows, routes annual leave and insufficient-balance cases to the manager, and updates balances automatically.
- Built an n8n + Slack task-intake automation that turns Slack messages (context, files, links) into structured rows in a manager's task sheet.
- Built a company-wide idea-submission automation in Slack, used as an ongoing source of productivity initiatives.
- Built a folder-management system: a deleted-files tracker (who and when, for recovery) and folder-access statistics, used to restructure the shared Drive.
- Administered team tool access and credentials, and ran vendor and subscription operations: expense tracking, renewal management, and cost-reduction analysis.
- Supported SEO strategy by researching how products use auxiliary tools and pages to drive organic traffic.
- Supported hiring and onboarding, including writing his own role's job description.

## Web Developer (React.js) — Saral Tech
Remote / Pune · Jan 2025 – Dec 2025
- Developed and maintained React.js interfaces for a trading platform and an online course platform: responsive components, dashboards, course listings, and UI updates.
- Maintained a client ticket-booking system and integrated REST APIs to support reliable user workflows.

## Web Developer (React.js / JavaScript) — TechSolutions
Pune · Dec 2023 – Jan 2025
- Developed and maintained web applications with JavaScript, React.js, Node.js, and Express.js, with responsive HTML/CSS interfaces.
- Integrated REST APIs, supported deployments and legacy-application updates, resolved client bugs, and used Git for version control.
