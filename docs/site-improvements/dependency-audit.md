# Dependency audit — September 2026

`npm audit` initially reported eight affected frontend package entries and nine
backend entries. Compatible lockfile updates, js-yaml 4.3.1, qs 6.16.0, and removal
of the unused image-size dependency reduce these to:

- Frontend, including development dependencies: zero.
- Backend production dependencies: zero.
- Backend including development dependencies: four moderate entries in the
  drizzle-kit → esbuild-kit → old esbuild development-tool chain.

These counts include transitive parent packages, not necessarily distinct flaws.
The remaining development advisory concerns esbuild's development server; the
application does not serve requests through that tool. Do not force npm's proposed
Drizzle downgrade or unsupported transitive compiler replacements. Revisit when
upstream migration tooling replaces the deprecated loader.

CI now rejects high/critical production dependency advisories for both packages.
Full application tests, frontend build, backend typecheck, and a migration generation
smoke check (output only in a temporary directory) validate the updates. No production
schema was changed by the dependency check.
