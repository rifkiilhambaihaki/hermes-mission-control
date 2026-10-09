# Contributing

Thank you for helping improve Hermes Mission Control. Contributions should keep the project read-only, privacy-preserving, and safe to run against local operator environments.

## Before you start

- Use an issue or discussion for substantial behavior, architecture, schema, or dependency changes so scope can be agreed before implementation.
- Report suspected vulnerabilities privately as described in [SECURITY.md](SECURITY.md), not in an issue, discussion, pull request, commit message, or test fixture.
- Keep changes focused. Separate unrelated refactors from fixes or features.
- By submitting a contribution, you represent that you have the right to submit it and agree that it may be distributed under this repository's MIT License.

## Development setup

Requirements are Node.js 24 and npm 11, matching the `engines` field in `package.json`.

```bash
git clone https://github.com/rifkiilhambaihaki/hermes-mission-control.git
cd hermes-mission-control
npm ci
npm run quality
```

Useful commands:

```bash
npm run typecheck   # strict server, web, and test type checks
npm run lint        # repository policy/foundation lint
npm test            # Vitest suite
npm run build       # server and production web builds
npm run build:demo  # demo-mode web build
npm run demo        # local demo on 127.0.0.1:4174
```

`npm run quality` is the required local gate and runs type checking, linting, tests, production builds, and the demo build. Keep `package-lock.json` synchronized when changing dependencies and use `npm ci` to verify the locked dependency graph.

## Workflow

1. Branch from the current default branch.
2. Add or update tests for behavior changes. Prefer deterministic, synthetic fixtures.
3. Preserve architecture boundaries and read-only behavior. Do not add mutation-capable Hermes commands or broaden process execution without prior design review.
4. Run `npm run quality`.
5. Open a pull request that explains the problem, approach, risk, tests, and any compatibility or privacy impact.
6. Respond to review and keep the branch current. Maintainers may ask for commits to be reorganized before merge.

Pull requests that change schemas, adapters, command/parser compatibility, authentication, process execution, or redaction should explicitly describe failure modes and include negative tests.

## Safety and privacy rules

This repository observes local operational state. Contributions must not turn those observations into accidental disclosure.

- Never commit credentials, tokens, cookies, API keys, private keys, `.env` contents, authentication hashes, or live configuration.
- Never commit real Hermes profiles, prompts, conversations, memories, schedules, board contents, financial/accounting records, submission records, logs, hostnames, IP addresses, usernames, home-directory paths, or other operator-identifying data.
- Use clearly fictional, minimal fixtures. Do not “anonymize” production data; create synthetic data instead.
- Keep examples portable: use placeholders such as `<profile>` and `/path/to/project`, not a contributor's machine details.
- Do not include exploit details for an unpatched vulnerability in a public test or pull request. Coordinate privately first.
- Do not add telemetry, remote analytics, external data transmission, or a new network listener without explicit maintainer review and clear documentation.
- Keep child-process execution bounded and allowlisted; avoid shell interpolation and avoid inheriting unnecessary environment variables.
- Treat all data read from local files, subprocesses, gateways, and snapshots as untrusted. Validate it and redact sensitive values before logging or returning it.
- Do not commit generated `dist/` output or `node_modules/`.

Before pushing, inspect the complete diff and commit history for sensitive data. If a secret or private record is committed, stop sharing the branch, rotate/revoke the affected secret, and privately notify the maintainer; deleting it in a later commit is not sufficient.

## Compatibility and clean-room contributions

Hermes-facing compatibility is independently implemented against observed interfaces. Contributions in these areas must be based on public documentation, contributor-owned observations, or synthetic fixtures that may lawfully be shared. Do not copy proprietary or non-public upstream source, tests, assets, or documentation. Record the interface behavior being supported and add focused contract tests without including private operational payloads.

## Dependencies and licensing

Prefer narrowly scoped dependencies with licenses compatible with MIT distribution. Explain why a new runtime dependency is needed. Update `package.json`, `package-lock.json`, and, when distribution obligations change, [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Do not vendor third-party code or assets without preserving required copyright, license, attribution, and notice material.

## Style

Follow the existing TypeScript conventions, strict typing, module boundaries, and nearby tests. Favor small, explicit interfaces and safe failure behavior over implicit fallbacks. Documentation and error messages should state what is known without exposing sensitive values.
