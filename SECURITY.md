# Security and privacy

WorkNote is a personal, single-administrator application. Run one API process per data directory. Concurrent processes writing the same Markdown files are not supported.

## Access boundaries

- The public overview exposes aggregate counts and configured project names. Use neutral project labels or an authenticated reverse proxy if even these names are private.
- A signed, HttpOnly, SameSite=Lax session cookie protects records, tasks, settings and private attachments. `WORKNOTE_SECRET` must contain at least 16 characters; initialization generates 32 random bytes. Secure cookies are enabled by default. Set `WORKNOTE_SECURE_COOKIE=false` only for local HTTP development.
- Changing the password does not revoke existing sessions. Change `WORKNOTE_SECRET` and restart to invalidate every session.
- A share token is a bearer credential. A project share exposes that project's tasks, module registry and schedule. A whole-library share intentionally exposes these for every project. The attachment endpoint only serves supported raster images referenced by tasks in the share's authorized scope. Daily Markdown and unreferenced record attachments are not part of the share.
- An edit share additionally allows the existing completion checkbox and task feedback. It cannot edit task percentages or arbitrary task metadata. Revoke a share to remove its access immediately.
- Login failures are rate-limited by client IP in memory. Trust forwarding headers only from explicitly configured reverse proxy addresses via `WORKNOTE_TRUST_PROXY`. A reverse proxy should replace incoming forwarding headers, not pass arbitrary client values through.

## Private data

Keep the entire data directory, `.env`, `site-config.json`, `shares.json`, screenshots, backups and Agent logs private. Runtime data is ignored by this source repository. Keep off-machine backups only in a private, access-controlled destination of your choosing. Do not attach real work records or tokens to GitHub issues.

AI and Webhooks are optional. AI requests send selected work text / screenshots or Agent context to the gateway you configure. Notifications send work summaries to the configured Webhook. Review those providers and destinations before enabling them. No analytics service is configured by the application.

Git snapshots and systemd controls are disabled by default. L2 Agent execution requires an explicitly enabled Git repository at the data root so changes can be restored. Do not point the application at a source repository or a data directory managed by another running instance.

Markdown HTML is sanitized before rendering. Uploaded images are limited to six per request and 8 MiB per image. Deployment should also impose appropriate HTTPS, request-size and request-rate limits at the proxy.

## Reporting a vulnerability

Use the repository's **Security → Advisories → Report a vulnerability** when private reporting is available. If unavailable, open an issue requesting a private contact without publishing a working exploit, credentials or work data. Include the affected version, expected access boundary and a minimal reproduction using fictional fixtures.

Dependency scanning and regression tests reduce known issues; they do not constitute a complete security audit. Keep the application and dependencies updated.
