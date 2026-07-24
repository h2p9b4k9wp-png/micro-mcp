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

The actual AI work happens server-side in two routes:
- [app/api/chat/route.ts](app/api/chat/route.ts) — main chat endpoint. Builds a single system prompt by concatenating: recent Supabase `logs` rows, the user's deadline list, parsed file contents, and (if search is active) live Tavily search results — then streams a DeepSeek (OpenAI-SDK-compatible, `baseURL: https://api.deepseek.com`) chat completion back as a raw text stream (`export const dynamic = 'force-dynamic'` so it isn't buffered). The "meeting notes" block asks the model to append a `<!--ACTION_ITEMS_JSON-->...<!--END_ACTION_ITEMS_JSON-->` sentinel block that the client parses out and turns into "add as deadline" suggestions — if you change this format, update the client-side regex in [app/page.tsx](app/page.tsx) to match.
- [app/api/parse-deadlines/route.ts](app/api/parse-deadlines/route.ts) — takes an uploaded file (base64), asks DeepSeek (`response_format: json_object`) to extract `{events: [{title, course, dueAt}]}`. Currently only accepts text-like content (`.txt`/`.csv`/`.ics`/`text/*`); image/PDF deadline extraction is explicitly unsupported here (contrast with `/api/chat`, which does OCR/PDF parsing for the file-analysis block — the two routes intentionally have different file-type coverage).

File parsing in `/api/chat` is dispatched by extension/mimetype: `.xlsx/.xls/.csv` → `xlsx`, `.hwp/.hwpx` → `@ohah/hwpjs`, `.pptx/.docx/.pdf` → `officeparser`, images → `tesseract.js` OCR (`eng`+`kor`). Legacy `.ppt`/`.doc` binary formats are explicitly rejected with a message asking users to re-save as `.pptx`/`.docx`.

Both AI-facing prompts explicitly instruct the model to treat file/search/log content as untrusted data and ignore any embedded instructions — preserve this prompt-injection guard when editing either system prompt.

### Auth

Supabase Auth (email/password + Google OAuth) gates the whole app via [middleware.ts](middleware.ts): any request that isn't `/login` or `/auth/*` requires a session, redirecting to `/login` (or returning a 401 JSON for `/api/*`). Because middleware already enforces this, the API routes under `app/api/` do **not** re-check auth themselves (see the comment at the top of each route) — don't add redundant auth checks there, but also don't remove the middleware gate without adding auth to those routes.

- [app/login/page.tsx](app/login/page.tsx) and [app/page.tsx](app/page.tsx) both construct their own `createBrowserClient` from `@supabase/ssr` using `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- [app/auth/callback/route.ts](app/auth/callback/route.ts) exchanges the OAuth `code` for a session server-side (`createServerClient`) and redirects to `/`.
- [app/api/v1/[username]/[slug]/route.ts](app/api/v1/[username]/[slug]/route.ts) is a separate public-ish REST endpoint (get/set a named `prompts` row for a `profiles.username`) that uses the Supabase **service role** key directly, bypassing RLS — it relies entirely on the middleware auth gate rather than per-row auth, so any authenticated user can currently read/write any username's prompt at a given slug. Be careful before extending this route's surface.

### Data model (Supabase)

Referenced tables (schema itself lives in Supabase, not in this repo): `logs` (`user_id`, `content`, `response`, `status`, `created_at` — chat history, also used for a simple 10-req/min rate limit in `/api/chat`), `profiles` (`id`, `username`), `prompts` (`user_id`, `slug`, `content`), `document_uploads` (`user_id`, `file_name`, `format`, `created_at` — append-only metadata log of every file attached via the file-analysis/deadline blocks, written client-side from [app/page.tsx](app/page.tsx); powers the cross-device "나의 기록" tab's document-format breakdown. `user_id` defaults to `auth.uid()` and RLS restricts rows to their owner. Migration: [supabase/migrations/20260724_create_document_uploads.sql](supabase/migrations/20260724_create_document_uploads.sql) — this is the one table whose DDL is tracked in-repo; apply it manually via the Supabase SQL Editor since the app only holds the anon/service-role keys, not schema-change credentials).

### Env vars

Required at runtime (not committed; see `.env.local` locally):
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — used client- and server-side
- `SUPABASE_SERVICE_ROLE_KEY` — server-only, used by the `/api/v1/[username]/[slug]` route
- `DEEPSEEK_API_KEY` — required by both `/api/chat` and `/api/parse-deadlines`; routes return a clean JSON error if missing rather than throwing
- `TAVILY_API_KEY` — optional; if unset, the search block degrades gracefully (tells the model to say so rather than guess)

### PWA

[app/manifest.ts](app/manifest.ts) + [public/sw.js](public/sw.js) make this an installable PWA. The service worker explicitly never caches `/api/*` requests (network-only) and network-first/cache-fallback for everything else. Registration happens client-side in both `page.tsx` and `login/page.tsx`.
