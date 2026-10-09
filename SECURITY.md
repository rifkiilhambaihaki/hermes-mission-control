# Security Policy

## Supported versions

Security fixes are prioritized for the current default branch and the latest published release, if releases exist. Older revisions may not receive fixes. Users should reproduce a suspected issue against the newest supported revision when it is safe to do so.

## Report a vulnerability privately

Please do **not** disclose a suspected vulnerability in a public issue, discussion, pull request, commit, log, or social-media post.

Use one of these private channels:

1. On the repository's GitHub page, open **Security → Advisories → Report a vulnerability** to create a private vulnerability report, when GitHub private vulnerability reporting is enabled.
2. If that option is unavailable, contact the maintainer through a private contact method published on the maintainer's GitHub profile or in the repository metadata. Ask for an appropriate secure channel before sending secrets, exploit code, or sensitive operator data.

No security email address is asserted by this project unless one is explicitly published through those official locations.

Include, where possible:

- the affected revision or version and component;
- impact and realistic attack prerequisites;
- minimal, reproducible steps or a proof of concept using synthetic data;
- relevant configuration with all credentials and personal or operational data removed;
- suggested remediation, if known; and
- whether the issue is already public or subject to a disclosure deadline.

Do not attach live credentials, private Hermes data, production snapshots, full environment dumps, or unnecessary logs. Provide hashes or narrowly redacted excerpts where they are sufficient. If sensitive material must be exchanged, first coordinate a secure transfer method with the maintainer.

## What to expect

The maintainer will make a reasonable effort to acknowledge the report, validate and assess it, coordinate a fix, and discuss disclosure. Response and remediation timing depends on severity, complexity, and maintainer availability; this document does not promise a specific service-level deadline. Please allow a reasonable remediation period and coordinate publication so users can update before technical details are released.

The project may ask for additional information or determine that a report is not a security issue. Good-faith reports that respect privacy and avoid disrupting other users are appreciated.

## Research safety

- Test only systems and data you own or are explicitly authorized to assess.
- Prefer local, isolated instances and synthetic fixtures.
- Do not access, alter, retain, or exfiltrate another person's data.
- Do not degrade availability, run destructive commands, or use social engineering.
- Stop testing and report privately if you encounter credentials, personal data, private prompts/conversations, financial records, or other unexpected sensitive material.
- Minimize collection and securely delete report artifacts when they are no longer needed.

This guidance does not grant authorization to test third-party systems, including GitHub, Hermes Agent infrastructure, or a user's deployment.

## Security-sensitive areas

Reports involving authentication, secret handling, redaction, local file access, path traversal, schema validation, child-process execution, command allowlists, environment isolation, browser exposure, or unintended mutation/data transmission are especially relevant. General hardening suggestions without a concrete security impact may be filed as ordinary issues.
