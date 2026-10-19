# RivaStock AI Bridge

The local worker makes outbound HTTPS requests to the Supabase Edge Function. It does not open a listening port. It processes one text-generation task at a time. It mirrors owner-managed text files into `.rivastock-ai/workspace` and can read a fixed allowlist of RivaStock source files when a task explicitly includes project context. The model never receives filesystem tools or unrestricted database access.

Copy `.env.example` to `.env`, set the endpoint and bridge token, then run `npm install` and `npm start`. Keep `.env` private; it is ignored by the repository's `.gitignore`.

Mock runs without a model provider. Codex and Claude Code require explicit opt-in using their `AI_BRIDGE_ENABLE_*` flags. See the repository's `AI_BRIDGE_SETUP.md` for backend setup, workspace synchronization, context limits, and provider requirements.
