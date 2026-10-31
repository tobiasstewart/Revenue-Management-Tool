# Revenue Management Tool

Hartmann Planning's revenue tracking: upload provider commission/fee statements each month, match every line to a client household and adviser, classify it as upfront / ongoing / one-off, and report what each adviser is owed (60% of upfront) and the business share by shareholding — on both the **received** basis (when money hit the bank) and the **generated** basis (the month it was earned).

Next.js 15 + Supabase (Sydney), deployed on Vercel. See `CLAUDE.md` for the data model and business rules.

## Local development

```bash
npm install
cp .env.example .env.local   # Supabase URL + publishable key
npm run dev                  # http://localhost:3000
```

## Checks

```bash
npm run typecheck && npm test && npm run build
```
