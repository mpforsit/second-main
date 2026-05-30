# 06 — Frontend Specification

## 6.1 Design language

Lattice's UI should feel calm, fast, and adult. The target user is overwhelmed by inputs; the tool should *reduce* visual noise, not add to it.

- **Density:** comfortable but not airy. Think Linear, not Notion.
- **Color:** neutral monochrome palette with one accent color (suggested: a muted indigo `#5B5FE3` or a warm orange `#E0793A` — pick one early and stick with it).
- **Type:** Inter for UI, a serif (Source Serif Pro or similar) for atom content reading view. System fonts are fine for v1.
- **Motion:** subtle. Use `framer-motion` for content transitions, never for delight-only animation.
- **Dark mode:** ship both from day one (`next-themes`).

## 6.2 Layout

A persistent three-zone layout on desktop, collapsible on mobile:

```
┌────────┬──────────────────────────────────┬─────────────┐
│        │                                  │             │
│  Side  │       Main content area          │  Right rail │
│  nav   │       (chapters / atoms / Q&A)   │  (capture   │
│        │                                  │   + intents │
│        │                                  │   surface)  │
│        │                                  │             │
└────────┴──────────────────────────────────┴─────────────┘
```

- **Sidebar (left):** Chapters list, Q&A link, Search link, User Model link, settings.
- **Main:** the current page.
- **Right rail:** always-visible Capture box at top; below it, today's surfaced intents and pending suggestions. Collapsible on narrow screens.

The right-rail Capture box is the single most important UI element. It is always present, always one keystroke away (`Cmd/Ctrl + K` to focus).

## 6.3 Routes (Next.js App Router)

| Path | Purpose |
|------|---------|
| `/login`, `/signup` | Auth |
| `/onboarding` | Cold-start interview |
| `/` | Dashboard: recent atoms, surfaced intents, capture |
| `/chapters` | All chapters list |
| `/chapters/[chapterId]` | Atoms in a chapter (chronological feed) |
| `/atoms/[atomId]` | Atom detail view |
| `/ask` | Q&A interface |
| `/search` | Full search results |
| `/user-model` | User model viewer / editor |
| `/settings` | Account, quota usage |

## 6.4 Key components

### `<CaptureBox>`

Lives in the right rail. Multi-modal capture.

States:
- **Idle**: text area placeholder "What just came in?".
- **Has content**: shows comment field, intent field (with action-type chooser dropdown), suggested chapter (after first round-trip), submit button.
- **Submitting**: spinner.
- **Submitted (pending)**: shows "Processing…" with a link to the new atom.

Input modes (tabs at top of box):
- **Text** (default): plain textarea. Also accepts URL on its own.
- **Voice**: record button. Uses `MediaRecorder` API. After stop, uploads to Supabase Storage and submits.
- **Upload**: drag-and-drop file picker (PDF/text for MVP).

Intent UI:
- Compact one-liner with action-type pill chooser (read / reach out / use in / research / review / share / decide).
- Optional due date picker.
- Free-text field.

Submit flow:
1. Show optimistic atom in the recent-atoms feed.
2. On server confirmation, show "Processing…" indicator.
3. On Realtime `atom.ready`, replace with rendered atom card.
4. Show suggested chapter as a banner with [Accept] [Change] [New chapter] buttons.

### `<AtomCard>`

Used in chapter feed and search results.

Shows:
- Source icon (📎 for URL, 🎙️ for voice, 📄 for PDF, 📝 for paste).
- Title (extracted title for URLs, first line otherwise).
- One-line snippet.
- Tags: chapter pill, intent pills if any (with due dates), comment indicator if a capture comment exists.
- Captured-at relative time.

Click → atom detail page.

### `<AtomDetail>` (page)

The full view of an atom.

Sections, top to bottom:
1. **Header**: title, source (with link/back-to-source button), captured-at, primary chapter (clickable, can be changed via dropdown).
2. **Content**: the full extracted/transcribed/pasted text. Serif font, generous line height.
3. **My notes**:
   - Capture comment (the one given at capture time).
   - List of additional comments (each with author + date + private/shared indicator).
   - Add-comment composer.
4. **Intents**: list of intents with action type, due date, status (open/done/dismissed) and inline toggles.
5. **Related**: panel of LLM-proposed and confirmed links. Each row: linked atom's title + chapter, with ✓/✗ buttons for suggested links and a kebab menu for confirmed links (to remove).

### `<ChapterFeed>` (page)

For `/chapters/[chapterId]`.

- Header with chapter name, atom count, edit button.
- Filter bar: by intent type, by date.
- Chronological list of `<AtomCard>` (newest first).
- Right rail still visible.

### `<AskInterface>` (page)

- Large input at top.
- On submit, response streams in below.
- Citations appear as inline pills `[Article — Maria's term sheet thoughts]` that link to the cited atom.
- Below the answer, the cited atoms appear as a list of `<AtomCard>` for quick reference.
- Recent questions shown in a sidebar (within main area), clickable to re-show.

### `<UserModelEditor>` (page)

Three sections — Projects, People, Vocabulary — each as an editable list.

- Each entry: editable inline; delete with confirmation.
- "Add" button at the bottom of each section.
- Save button at top of page; warns about unsaved changes when navigating away.

### `<OnboardingChat>` (page)

A focused, full-screen chat interface (no sidebar, no rail).

- Anthropic's streamed responses render token-by-token.
- User responds with a textarea + send button.
- Progress indicator: "Step X of about 5".
- When the model emits `<onboarding_complete>`, the UI:
  1. Parses the block.
  2. Shows a confirmation screen: "Here's your starter setup" with the suggested chapters and a summary of the user model.
  3. User clicks "Looks good, let's go" → `completeOnboarding` server action.
  4. Redirect to `/`.

### `<SurfaceFeed>`

Lives in right rail below capture (MVP: shows recent atoms + pending suggestions; Phase 2: full proactive surfacing).

MVP content:
- Atoms that were just captured and are now ready.
- Open chapter suggestions awaiting decision.
- Open link suggestions awaiting decision.

## 6.5 Key interaction patterns

### Keyboard shortcuts

- `Cmd/Ctrl + K`: focus capture box.
- `Cmd/Ctrl + Enter` in capture box: submit.
- `Cmd/Ctrl + /`: jump to Q&A.
- `Esc`: collapse capture box to idle.

### Optimistic UI

- New atoms appear immediately in the recent feed (status: pending).
- Suggestion acceptances apply immediately; server confirms in background.
- Intent toggles flip immediately.

### Empty states

Each list view has a thoughtful empty state. The dashboard's empty state for new users is a one-liner: "Drop something into the box on the right →".

### Loading states

- Atom processing: small spinner on atom card with "Extracting…", "Embedding…", "Classifying…" mini-text reflecting Inngest step events (Phase 2: these are pushed via Realtime). MVP: just "Processing…".
- Q&A: streaming response, with a typing indicator.

### Error states

- Quota exceeded: friendly modal explaining limits, with a "remaining this month" breakdown and an "Upgrade" CTA (Phase 4+).
- Network errors: toast with retry.
- Capture failures (e.g., bad URL): keep atom in a `failed` state; show retry button on atom card.

## 6.6 Accessibility

- All interactive elements have visible focus rings.
- Tab order is logical.
- Screen reader labels on icon-only buttons.
- Color contrast meets WCAG AA in both light and dark mode.
- Voice capture has a clear "recording in progress" indicator (not just a pulse — also a timer and a visible "stop" button).

## 6.7 Mobile (MVP scope)

MVP is responsive-web only. On narrow screens:
- Three zones collapse into a single column with a tab bar at the bottom (Capture / Browse / Ask).
- The Capture tab is the home screen.
- Voice capture and paste-from-clipboard are the dominant inputs.

Phase 2 will add PWA share-target integration.

## 6.8 Frontend libraries

```
"dependencies": {
  "next": "^15",
  "react": "^19",
  "react-dom": "^19",
  "@supabase/ssr": "...",
  "@supabase/supabase-js": "...",
  "@anthropic-ai/sdk": "...",
  "openai": "...",
  "inngest": "...",
  "@tanstack/react-query": "^5",
  "react-hook-form": "^7",
  "zod": "^3",
  "framer-motion": "^11",
  "next-themes": "...",
  "lucide-react": "...",
  "@radix-ui/react-*": "...",   // via shadcn/ui
  "tailwindcss": "^3",
  "@upstash/ratelimit": "...",
  "@mozilla/readability": "...",
  "jsdom": "...",
  "pdf-parse": "...",
  "@dqbd/tiktoken": "...",
  "date-fns": "^3",
  "uuid": "^10"
}
```

## 6.9 Component creation guidance

Use shadcn/ui as the base for every primitive (button, dialog, dropdown, input, tabs, etc.). Compose feature components from shadcn primitives. Custom design tokens via CSS variables in `globals.css`. Tailwind classes for layout/spacing.

Do not pull in additional UI libraries (Material, Chakra, Mantine). Stay consistent.
