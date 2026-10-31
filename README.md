# Revenue Management Tool

Hartmann Planning revenue management tool. Next.js 15 (App Router, React 19) + Supabase, deployed on Vercel (Sydney).

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in the Supabase project URL + keys
npm run dev                  # http://localhost:3000
```

Apply `supabase/migrations/` to your Supabase project, then create a firm and a `users` row for your auth user (service role) to sign in.

## Checks

```bash
npm run typecheck && npm test && npm run build
```
