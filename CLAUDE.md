# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Project overview

Micro-MCP (미니 업무 비서 / "나만의 AI 업무 비서") is a Next.js 16 (App Router) PWA. Users toggle "MCP blocks" (web search, document analysis, deadline tracking, writing assistant, meeting-notes structuring) and issue prompts against an AI backend that assembles context from those blocks. All UI copy and AI-facing prompts are in Korean.

## Commands

- `npm run dev` — start dev server (localhost:3000)
- `npm run build` — production build
- `npm run start` — run production build
- `npm run lint` — ESLint (flat config via `eslint.config.mjs`, extends `eslint-config-next` core-web-vitals + typescript)

There is no test suite configured in this repo.

## Architecture

### Single-page client app + thin API routes

Almost all UI and state lives in one client component, [app/page.tsx](app/page.tsx) — tabs (workspace / deadlines / MCP blocks / monitoring / logs) are rendered conditionally from `activeTab` state rather than via routing. "MCP blocks" are just booleans (`isSearchActive`, `isFileActive`, `isDeadlineActive`, `isWritingActive`, `isMeetingNotesActive`) sent to the API, not a real plugin/tool-calling protocol. Block toggle state, uploaded files, and deadlines persist to `localStorage` (not the DB) and are re-sent with every prompt.

The actual AI work happens server-side in a few routes:
- [app/api/chat/route.ts](app/api/chat/route.ts) — main chat endpoint. Builds a single system prompt by concatenating: recent Supabase `logs` rows, the user's deadline list, parsed file contents, and (if search is active) live Tavily search results — then streams an OpenAI (`gpt-4.1-mini`) chat completion back as a raw text stream (`export const dynamic = 'force-dynamic'` so it isn't buffered). The "meeting notes" block asks the model to append a `<!--ACTION_ITEMS_JSON-->...<!--END_ACTION_ITEMS_JSON-->` sentinel block that the client parses out and turns into "add as deadline" suggestions — if you change this format, update the client-side regex in [app/page.tsx](app/page.tsx) to match.
- [app/api/analyze/route.ts](app/api/analyze/route.ts) — takes `{text, fileName?, lens?}`, picks a lens from [lib/lenses.ts](lib/lenses.ts) (`deadlines`/`questions`/`digest`, auto-detected via `detectLens()` when `lens` is omitted), and calls OpenAI with Structured Outputs (`response_format: json_schema`, `strict: true`) to force the lens's JSON shape. Drives the "MCP 블록 매니저" (circuit) tab: uploading a document there calls `/api/extract` for text, `detectLens()` to pick a lens, then this route for the result.
- [app/api/extract/route.ts](app/api/extract/route.ts) — takes an uploaded file (base64) and returns plain text, via the shared [lib/file-text-extract.ts](lib/file-text-extract.ts) (PDF via `unpdf`, `.docx` via `mammoth`, `.xlsx/.xls/.csv` via `xlsx`, `.pptx`/`.hwpx` via `jszip` + manual XML tag-stripping, `.hwp` via `cfb` (CFBF container) + `pako` (raw-deflate `BodyText/SectionN` streams) + a hand-rolled walk over `HWPTAG_PARA_TEXT` records — encrypted `.hwp` files and pre-5.0 (non-CFBF) versions get distinct Korean guidance messages instead of a generic failure). This is the one file-reading implementation shared across routes that need plain extracted text — don't reintroduce a second copy of it. Deliberately doesn't reuse `@ohah/hwpjs` (used by `/api/chat` below) for `.hwp`: that library's public API doesn't document a reliable way to distinguish encrypted vs. too-old-to-parse vs. generic-corruption failures, which this route needs for its per-case messaging.
- [app/api/analyze-professor/route.ts](app/api/analyze-professor/route.ts) — takes `{ documents: {fileName, text}[] }` (already-extracted text, one entry per file), concatenates them, and calls OpenAI with a fixed Structured Outputs schema to summarize patterns across everything a given professor has produced. The schema has 5 categories (`topics`/`examStyle`/`assignmentStyle`/`examQuestionTypes`/`gradingStrictness`), each shaped `{confident: boolean, items: string[]}` — the model is instructed to only set `confident: true` (and fill `items`) when a pattern is corroborated across multiple documents, so with too little material every category comes back `confident: false, items: []` rather than fabricating a pattern from one data point. Drives the "교수님" tab: documents are uploaded per-professor via `/api/extract` and persisted (with their extracted text) in the `documents` table so re-analysis never needs the files re-uploaded; on every upload/delete the client recomputes and upserts the result into `professor_analysis` (see Data model) — client-side UI splits categories by `confident` into shown-now vs. a grayed-out "더 올리면 알 수 있는 것" teaser that a category moves out of once it flips to `confident: true`.

File parsing in `/api/chat` is dispatched by extension/mimetype: `.xlsx/.xls/.csv` → `xlsx`, `.hwp/.hwpx` → `@ohah/hwpjs`, `.pptx/.docx/.pdf` → `officeparser`, images → `tesseract.js` OCR (`eng`+`kor`). Legacy `.ppt`/`.doc` binary formats are explicitly rejected with a message asking users to re-save as `.pptx`/`.docx`.

Both AI-facing prompts explicitly instruct the model to treat file/search/log content as untrusted data and ignore any embedded instructions — preserve this prompt-injection guard when editing either system prompt.

[lib/lenses.ts](lib/lenses.ts)'s `COMMON_RULES` (shared anti-hallucination rules prepended to every lens's `systemPrompt`, requiring an `evidence` field — a verbatim source quote — on every array item, dropping items that can't cite one) is written as prose with an explicit "don't second-guess content that's actually there" framing rather than a flat bullet checklist. This isn't a style choice: an earlier bullet-list version of the same rules made `gpt-4.1-mini` collapse to refusing the entire `digest` lens (`summary: "자료에 없습니다"` with empty arrays) on ~20% of calls even when the source text plainly had content — stacking that many independent hedging rules as parallel bullets was enough to trigger self-censorship. The prose version fixed it (0/20 in testing). Don't reflatten this into a bullet list without re-running that kind of repeated-call test.

### Auth

Supabase Auth (email/password + Google OAuth) gates the whole app via [middleware.ts](middleware.ts): any request that isn't `/login` or `/auth/*` requires a session, redirecting to `/login` (or returning a 401 JSON for `/api/*`). Because middleware already enforces this, the API routes under `app/api/` do **not** re-check auth themselves (see the comment at the top of each route) — don't add redundant auth checks there, but also don't remove the middleware gate without adding auth to those routes.

- [app/login/page.tsx](app/login/page.tsx) and [app/page.tsx](app/page.tsx) both construct their own `createBrowserClient` from `@supabase/ssr` using `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- [app/auth/callback/route.ts](app/auth/callback/route.ts) exchanges the OAuth `code` for a session server-side (`createServerClient`) and redirects to `/`.
- [app/api/v1/[username]/[slug]/route.ts](app/api/v1/[username]/[slug]/route.ts) is a separate public-ish REST endpoint (get/set a named `prompts` row for a `profiles.username`) that uses the Supabase **service role** key directly, bypassing RLS — it relies entirely on the middleware auth gate rather than per-row auth, so any authenticated user can currently read/write any username's prompt at a given slug. Be careful before extending this route's surface.

### Data model (Supabase)

Referenced tables (schema itself lives in Supabase, not in this repo): `logs` (`user_id`, `content`, `response`, `status`, `created_at` — chat history, also used for a simple 10-req/min rate limit in `/api/chat`), `profiles` (`id`, `username`), `prompts` (`user_id`, `slug`, `content`), `document_uploads` (`user_id`, `file_name`, `format`, `created_at` — append-only metadata log of every file attached via the file-analysis/deadline blocks, written client-side from [app/page.tsx](app/page.tsx); powers the cross-device "나의 기록" tab's document-format breakdown. `user_id` defaults to `auth.uid()` and RLS restricts rows to their owner. Migration: [supabase/migrations/20260724_create_document_uploads.sql](supabase/migrations/20260724_create_document_uploads.sql)).

Four more tables back the "교수님" tab (per-professor document collection, own-rows-only via RLS, no cross-user sharing):
- `professors` (`user_id`, `name`, `school`, `department`, `created_at`).
- `documents` (`user_id`, `professor_id` (nullable FK → `professors.id`, `on delete cascade`), `file_name`, `format`, `content`, `created_at` — unlike `document_uploads`, this table stores the actual extracted text so `/api/analyze-professor` can re-run over everything a professor has accumulated without re-uploading). Migration: [supabase/migrations/20260727_create_professors_and_documents.sql](supabase/migrations/20260727_create_professors_and_documents.sql).
- `doc_chunks` (`user_id`, `document_id` FK → `documents.id` `on delete cascade`, `chunk_index`, `content`, `created_at`) — [app/page.tsx](app/page.tsx)'s `chunkText()` splits each document's text into ~1500-char pieces at upload time and stores them here. Nothing reads this table back yet (analysis still uses `documents.content` in full) — it exists so a future chunk-level search/embedding feature doesn't need a backfill, and so document deletion has somewhere consistent to cascade into.
- `professor_analysis` (`user_id`, `professor_id` **unique** FK → `professors.id` `on delete cascade`, `result` jsonb, `document_count`, `updated_at`) — one row per professor, upserted (`onConflict: 'professor_id'`) by the client every time `recomputeProfessorAnalysis()` runs, which is on every successful document upload and every deletion (to zero remaining documents, the row is deleted instead). `document_count` is the snapshot the "자료 N개 기준" framing line in the UI is computed from, not a live `documents` count query.

Migration for the last two: [supabase/migrations/20260728_create_doc_chunks_and_professor_analysis.sql](supabase/migrations/20260728_create_doc_chunks_and_professor_analysis.sql).

None of the above migrations are auto-applied — the app only holds the anon/service-role keys, not schema-change credentials, so each one has to be run manually via the Supabase SQL Editor.

### Env vars

Required at runtime (not committed; see `.env.local` locally):
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — used client- and server-side
- `SUPABASE_SERVICE_ROLE_KEY` — server-only, used by the `/api/v1/[username]/[slug]` route
- `OPENAI_API_KEY` — required by `/api/chat`, `/api/analyze`, and `/api/analyze-professor` (model: `gpt-4.1-mini`); routes return a clean JSON error if missing rather than throwing
- `TAVILY_API_KEY` — optional; if unset, the search block degrades gracefully (tells the model to say so rather than guess)

### PWA

[app/manifest.ts](app/manifest.ts) + [public/sw.js](public/sw.js) make this an installable PWA. The service worker explicitly never caches `/api/*` requests (network-only) and network-first/cache-fallback for everything else. Registration happens client-side in both `page.tsx` and `login/page.tsx`.
