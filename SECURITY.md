# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report it privately through GitHub: [**Report a vulnerability**](https://github.com/mafauth2/askmetry/security/advisories/new) (Security tab → "Report a vulnerability"). Only the maintainers can see these reports.

Please include a description, steps to reproduce, affected version/commit and the impact you see. We aim to acknowledge reports within 5 working days and to agree on a disclosure date with you. We are a small project and cannot pay bug bounties, but we are happy to credit you.

## Supported versions

Askmetry has no stable releases yet. Security fixes land on `main`; please reproduce against the latest `main` before reporting.

## Scope

In scope: the web app (authentication, tenant separation between workspaces, access to other users' data), the worker (e.g. server-side request forgery through the website check or logo fetching), the Docker setup, and leaks of API keys.

Out of scope: vulnerabilities in third-party services (OpenAI, Anthropic, Google, DataForSEO), missing hardening of a deployment you control (TLS, reverse proxy, firewall), and denial of service through very large workloads you configured yourself.

## Hardening tips for self-hosters

- Keep the web port bound to `127.0.0.1` (default) and put a reverse proxy with TLS in front.
- Set a long random `BETTER_AUTH_SECRET` and `POSTGRES_PASSWORD`; never commit `.env`.
- Set `ASKMETRY_ALLOW_SIGNUP=false` once your accounts exist, and keep `ASKMETRY_MAX_BUDGET_USD` low to limit API spend.
- Use API keys with spending limits at the providers.
