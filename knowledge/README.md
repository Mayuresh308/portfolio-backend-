# Knowledge library

Everything the chat assistant knows about Mayuresh comes from the markdown files in this folder.
No endpoint ever returns these files; they only go into the model's system prompt.

## How it works

- Every `*.md` file here is loaded automatically, sorted by filename. This `README.md` is skipped.
- Files are joined under `### <filename>` headers and placed inside the system prompt.
- They are read once per cold start. After editing, redeploy (or restart `vercel dev`).
- HTML comments (`<!-- ... -->`) are removed before loading, so use them for notes to yourself.
  Don't put real facts inside comments; the assistant won't see them.

## Adding information

1. Add bullets to an existing file (look for `<!-- add more bullets -->`), or create a new file,
   e.g. `certifications.md` or `experience-<company>.md`.
2. Write only facts you're happy for visitors to read back. The assistant is told to answer
   only from these files and never to invent anything, so anything missing is "unknown".
3. Put caveats next to the numbers they qualify (e.g. "on a manually reviewed test sample").
   The assistant is told to keep them together.
4. `faq.md` has empty sections. Until you fill one in, the assistant treats it as unknown and
   tells visitors to email you.
5. Keep it short. Everything here is sent with every request, so very large files cost tokens
   and add latency.

Then run `pnpm eval` to spot-check answers.
