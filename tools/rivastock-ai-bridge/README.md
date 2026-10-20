# RivaStock AI Bridge

The local worker makes outbound HTTPS requests to the Supabase Edge Function. It does not open a listening port. It processes one text-generation task at a time. Each RivaStock account pairs its own PC and receives an isolated workspace mirror under `.rivastock-ai/workspace`. It can read a fixed allowlist of RivaStock source files when a task explicitly includes project context. The model never receives filesystem tools or unrestricted database access.

Copy `.env.example` to `.env`, then copy the account-specific endpoint, pairing token, and worker ID from **RivaStock > IA > Conectar una PC**. Run `npm install` and `npm start`. Keep `.env` private; it is ignored by the repository's `.gitignore`.

Mock runs without a model provider. Codex and Claude Code require explicit opt-in using their `AI_BRIDGE_ENABLE_*` flags. See the repository's `AI_BRIDGE_SETUP.md` for backend setup, workspace synchronization, context limits, and provider requirements.
