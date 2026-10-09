# Third-Party Notices

This project is licensed under the MIT License; see [LICENSE](LICENSE). It depends on third-party software governed by its own licenses. This file is informational and does not replace or modify those license terms.

## Source-repository dependency summary

The source repository does not vendor `node_modules/` or generated `dist/` output. Dependencies are resolved from `package-lock.json` during installation. At the locked versions recorded when this notice was prepared, the direct runtime dependencies report the following licenses in npm package metadata:

- `ajv` 8.20.0 — MIT
- `ajv-formats` 3.0.1 — MIT
- `fastify` 5.12.5 — MIT
- `react` 19.3.0 — MIT
- `react-dom` 19.3.0 — MIT
- `react-router-dom` 7.18.4 — MIT

These packages have transitive dependencies, and development/build dependencies are also present. `package-lock.json` is the authoritative inventory for the exact locked graph in a given revision. Package metadata is useful for review but is not a substitute for reading the license files shipped by each package.

Hermes Agent is an interoperated-with external project, not an npm dependency vendored by this repository. Hermes Agent 0.16.0 is MIT-licensed, copyright © 2025 Nous Research. See [ACKNOWLEDGEMENTS.md](ACKNOWLEDGEMENTS.md) for the acknowledgement and independent-project disclaimer.

## Obligations for downstream distributions

A distributor who ships only this source repository should retain this project's `LICENSE` and all existing notices. A distributor who creates a bundled, packaged, containerized, executable, or otherwise self-contained distribution may copy third-party code into the delivered artifact, even when `node_modules/` is absent from the repository. That distributor is responsible for the resulting artifact and should, before release:

1. Generate an inventory from the exact production lockfile and final artifact, including transitively bundled packages and assets.
2. Verify each component's actual license and version from the installed package or upstream release; do not rely solely on this summary.
3. Include all required copyright statements, license texts, attribution files, `NOTICE` files, and source or offer materials required by the applicable licenses.
4. Preserve notices embedded in JavaScript, CSS, source maps, assets, documentation, and other redistributed files; ensure minification or concatenation does not remove notices that must remain.
5. Account separately for optional, platform-specific, dynamically downloaded, vendored, or container/base-image components that may not appear in the ordinary production dependency tree.
6. Repeat the review whenever dependencies, lockfiles, build tooling, assets, base images, or bundling behavior change.
7. Place notices where recipients can reasonably find them—for example, in a `THIRD_PARTY_NOTICES` file shipped with the artifact and, where appropriate, in an application's legal/about view or accompanying documentation.

Useful starting points include an npm production dependency inventory (`npm ls --omit=dev --all` after `npm ci --omit=dev`) and inspection of the final web/server artifacts. License-scanning tools can assist, but ambiguous, compound, custom, or missing metadata requires manual review.

If a downstream product separately bundles or distributes Hermes Agent, it must also comply with Hermes Agent's MIT License and preserve its applicable copyright and permission notice. Merely interoperating with a separately installed Hermes Agent does not make Hermes Agent part of this repository's distribution.

This notice is not legal advice. Distributors remain responsible for confirming and satisfying all licenses applicable to what they ship.
