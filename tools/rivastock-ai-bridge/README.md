# RivaStock AI Bridge

The local worker makes outbound HTTPS requests to the Supabase Edge Function. It does not open a listening port. It processes one text-generation task at a time. Each RivaStock account pairs its own PC and receives an isolated workspace mirror under `.rivastock-ai/workspace`. It can read a fixed allowlist of RivaStock source files when a task explicitly includes project context. The model never receives filesystem tools or unrestricted database access.

Download the standalone package from **RivaStock > IA > Vincular esta PC** and extract it. In the extracted folder, run `npm install`, copy `.env.example` to `.env`, and paste the account-specific endpoint, pairing token, and worker ID shown in RivaStock. Sign in to Codex on that PC, then run `npm start`. Keep `.env` private; it is never included in the downloadable package.

Mock runs without a model provider. Codex and Claude Code require explicit opt-in using their `AI_BRIDGE_ENABLE_*` flags. The standalone package does not include the RivaStock source repository. Project source context stays off unless `AI_BRIDGE_PROJECT_ROOT` points to a RivaStock checkout; business knowledge and catalog context remain available per account.
