---
description: Run ONE phase of the Medionary Auth module (asks for the phase number)
---

Follow the always-on rules in `.github/copilot-instructions.md`.

Read these first:
- `docs/auth-phases.md` (phases, Google OAuth requirements, test list)
- `supabase/migrations/` (the `medionary_full.sql` file is the database source of truth)

Do ONLY **Phase ${input:phase}** from `docs/auth-phases.md`. If it is Phase 0, write no code.
When done: stop, summarise what changed, show lint + typecheck + test output, list anything
you were unsure about, and wait for me to say "continue".