# Second

A web-based "second brain": throw in text, links, documents, or voice memos with a short comment expressing intent. The system organises captures into _chapters_, proposes links between related items, and answers natural-language questions grounded in your own material.

The complete spec lives in [`docs/`](./docs). Start with [`docs/README.md`](./docs/README.md) for the document index, then [`docs/07-phase-1-buildplan.md`](./docs/07-phase-1-buildplan.md) for the 15-step build sequence.

## Quick start

```bash
pnpm install
cp .env.local.example .env.local   # fill in Supabase + LLM keys
pnpm dev
```

Open <http://localhost:3000>.

## Toolchain

- Next.js 16 (App Router) on Node 24
- Tailwind CSS 4 + [shadcn/ui](https://ui.shadcn.com) (Radix)
- Supabase (Postgres + pgvector, Auth, Storage)
- pnpm, TypeScript strict, ESLint, Prettier, Husky + lint-staged, commitlint (conventional)

Env vars are listed in [`docs/02-architecture.md`](./docs/02-architecture.md) §2.7 and mirrored in [`.env.local.example`](./.env.local.example).

## Scripts

| Command          | Purpose          |
| ---------------- | ---------------- |
| `pnpm dev`       | Local dev server |
| `pnpm build`     | Production build |
| `pnpm typecheck` | `tsc --noEmit`   |
| `pnpm lint`      | ESLint           |
| `pnpm format`    | Prettier write   |
