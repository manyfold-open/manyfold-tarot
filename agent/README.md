# AI Tarot Narra Agent (`tarot-master-2`)

Files deployed to the Manyfold sandbox for the AI Tarot Narra Messenger agent:

- `AGENTS.md`: Reader persona, Shared Behavioral Standard (4 use cases, `[NO_REPLY]` multi-@ / agent silence, 3-minute group follow-up continuity, per-person trilingual `zh-Hant` / `zh-Hans` / `en`, crisis safety net, privacy boundaries, command allowlist).
- `tarot.py`: CSPRNG three-card draws, spread listing, and single-card lookup with pure Traditional (`zh-Hant`), pure Simplified (`zh-Hans` / `zh`), and English (`en`) output.
- `memory.py`: Stdlib SQLite preference memory (`~/.cache/tarot/memory.sqlite3`), scoped strictly by `room_id` (`chat_id`) and optional `user_id` (`sender_id`) with injection and personal-worry filtering.
- `deck.json`: Exported 78-card deck and 4 spreads (`src/shared/tarot/deck.ts` and `spreads.ts`).

## Note on Card Art (`cards.zip`)

`cards.zip` (and unpacked `cards/*.jpg`) is a binary asset bundle already present in the live Manyfold sandbox (generated from `public/cards/`). It is intentionally **not** committed to this repository.

## Running Tests

```bash
python3 -m unittest agent/test_agent.py
```
