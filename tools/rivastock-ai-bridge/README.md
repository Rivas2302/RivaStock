# RivaStock AI Bridge

The local worker makes outbound HTTPS requests to the Supabase Edge Function. It does not open a listening port. It processes one text-generation task at a time. Each RivaStock account pairs its own PC and receives an isolated workspace mirror under `.rivastock-ai/workspace`. It can read a fixed allowlist of RivaStock source files when a task explicitly includes project context. The model never receives filesystem tools or unrestricted database access.

On Windows, download the personalized installer from **RivaStock > IA > Vincular esta PC**, extract it, and double-click `Iniciar RivaStock AI Bridge.bat`. It activates the pairing, installs the worker dependencies, opens Codex sign-in when needed, and starts the worker. Keep the terminal open while using RivaStock. The ZIP contains a private account credential; delete the ZIP after extraction and keep the extracted `.env` private.

For a manual installation on another operating system, download the standalone `.tgz` from the same screen, run `npm install`, copy `.env.example` to `.env`, and add the account-specific endpoint, pairing token, and worker ID. Then sign in to Codex using the same isolated `CODEX_HOME` configured for the worker and run `npm start`.

Mock runs without a model provider. Codex and Claude Code require explicit opt-in using their `AI_BRIDGE_ENABLE_*` flags. The standalone package does not include the RivaStock source repository. Project source context stays off unless `AI_BRIDGE_PROJECT_ROOT` points to a RivaStock checkout; business knowledge and catalog context remain available per account.
