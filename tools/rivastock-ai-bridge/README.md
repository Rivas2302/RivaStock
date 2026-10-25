# RivaStock AI Bridge

The local worker makes outbound HTTPS requests to the Supabase Edge Function. It does not open a listening port. It processes one task at a time. Each RivaStock account pairs its own PC and receives an isolated workspace mirror under `.rivastock-ai/workspace`. Codex tasks run with live web search, terminal and filesystem tools, full access to the linked PC, and no per-action approval prompts. The pairing token is omitted from Codex's process environment, but files readable by the linked Windows user—including the installation `.env`—remain accessible through full filesystem access. Business data is still supplied as scoped context rather than a direct database connection.

On Windows, download the personalized installer from **RivaStock > IA > Vincular esta PC**, extract it, and double-click `Iniciar RivaStock AI Bridge.bat`. It activates the pairing, installs the worker dependencies, opens Codex sign-in when needed, and starts the worker in the background. It also installs a shortcut in the current user's Startup folder so the worker starts again at the next sign-in. The terminal can be closed after the installer reports success. The ZIP contains a private account credential; delete the ZIP after extraction and keep the extracted `.env` private.

To update, download and run the single file from **RivaStock > IA > Actualizar AI Bridge**. It finds the installation for the linked device, waits for active work, updates it in place, preserves the pairing and local sessions, and restarts the worker in the background. The Startup shortcut is refreshed during the update.

For a manual installation on another operating system, download the standalone `.tgz` from the same screen, run `npm install`, copy `.env.example` to `.env`, and add the account-specific endpoint, pairing token, and worker ID. Then sign in to Codex using the same isolated `CODEX_HOME` configured for the worker and run `npm start`.

Mock runs without a model provider. Codex and Claude Code require explicit opt-in using their `AI_BRIDGE_ENABLE_*` flags. The standalone package does not include the RivaStock source repository. Project source context stays off unless `AI_BRIDGE_PROJECT_ROOT` points to a RivaStock checkout; business knowledge and catalog context remain available per account.

## Knowledge indexing and semantic search

The worker processes document indexing and semantic search requests for the linked account over outbound HTTPS. Set `AI_BRIDGE_WORKER_ID` to the device ID shown in RivaStock and keep `AI_BRIDGE_ENDPOINT` on the `/functions/v1/ai-bridge` endpoint; the worker derives the matching `/functions/v1/knowledge` endpoint. Knowledge processing is enabled by default and can be disabled with `AI_BRIDGE_ENABLE_KNOWLEDGE=false`.

The first indexing task downloads the quantized `Xenova/multilingual-e5-small` model (about 120 MB). It is cached under `%USERPROFILE%\.rivastock-ai-bridge\models` by default; set `AI_BRIDGE_MODELS_DIR` to change this location. PDF, DOCX, Markdown, and text files are indexed locally. Image OCR is optional and disabled by default; set `AI_BRIDGE_ENABLE_OCR=true` only after installing an OCR-enabled worker build.

The Windows background worker writes to `%USERPROFILE%\.rivastock-ai-bridge\logs\worker.log`. A manual worker prints status and errors in its terminal. Error messages redact signed URLs, credentials, and local paths.
