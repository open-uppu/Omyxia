# Contributing to Omyxia

Thank you for your interest in contributing! 🎉

Omyxia is an AGPL-3.0 project — by contributing, you agree that your contributions will be licensed under the same terms.

## Quick Links

- 📋 [Code of Conduct](#code-of-conduct)
- 🐛 [Report a Bug](#report-a-bug)
- 💡 [Suggest a Feature](#suggest-a-feature)
- 🔧 [Submit a Pull Request](#submit-a-pull-request)
- 🌐 [Translations](#translations)

---

## Code of Conduct

This project follows the [Contributor Covenant](https://www.contributor-covenant.org/). Be respectful, inclusive, and constructive. We have zero tolerance for harassment.

---

## Report a Bug

1. **Check existing issues** — search the [issue tracker](https://github.com/open-uppu/omyxia/issues) first.
2. **Use the bug report template** — provide:
   - Reproduction steps (minimal example)
   - Expected vs actual behavior
   - Environment (Node version, OS, Postgres version)
   - Relevant logs / error output
3. **Security issues?** See [SECURITY.md](SECURITY.md) — **do not** file public issues.

---

## Suggest a Feature

1. Open an issue with the `feature-request` label
2. Describe the **problem** you're solving (not just the solution)
3. Sketch the proposed API/UX if possible
4. Note any breaking-change implications

We'll discuss the design before any code is written.

---

## Submit a Pull Request

### Setup

```bash
# Fork the repo on GitHub, then:
git clone https://github.com/<you>/omyxia.git
cd omyxia
pnpm install
cp .env.example .env
sg docker -c 'docker compose -f infra/docker-compose.yml up -d'
pnpm db:migrate
pnpm db:seed
```

### Workflow

```bash
# 1. Branch from main
git checkout main
git pull upstream main
git checkout -b feat/my-feature

# 2. Make changes + write tests
# Edit code, add tests in same file (*.spec.ts) or in apps/api/test/

# 3. Verify locally — ALL must pass
pnpm type-check
pnpm lint
pnpm test
pnpm test:e2e
pnpm --filter @omyxia/api test:integration
pnpm build

# 4. Commit with Conventional Commits
git add -A
git commit -m "feat(crm): add lead scoring algorithm"

# 5. Push & open PR
git push origin feat/my-feature
gh pr create --fill
```

### Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(scope): add new feature       → minor version bump
fix(scope): fix a bug              → patch version bump
docs(scope): documentation only    → no version bump
refactor(scope): no behavior change → no version bump
test(scope): add/fix tests         → no version bump
chore(scope): tooling/infra        → no version bump

BREAKING CHANGE: footer           → major version bump
```

Examples:

```
feat(erp): add multi-currency support
fix(auth): correct JWT expiration calculation
docs(readme): update setup instructions
test(payroll): add 90% coverage for calculate()
```

### Code Style

- **TypeScript**: strict mode, no `any` unless justified with comment
- **Naming**: `camelCase` for variables/functions, `PascalCase` for classes/types
- **Imports**: organized by `external` → `internal` → `parent` → `sibling`
- **Tests**: every new feature needs a `.spec.ts`; aim for ≥80% coverage
- **Multi-tenant**: every new entity **must** have `tenantId` + RLS migration
- **Schema changes**: bump `schema.prisma` + write a numbered migration in `prisma/migrations/`

### Pull Request Checklist

- [ ] PR title follows Conventional Commits
- [ ] All CI checks pass (type-check, lint, test, build, integration)
- [ ] New code has tests (unit + integration if schema-affecting)
- [ ] Multi-tenant safety verified (RLS enabled + tenant scope)
- [ ] Docs updated if user-facing change
- [ ] No secrets in committed files
- [ ] Migration written if schema change

---

## Translations

Omyxia supports `en` + `th` out of the box. Adding a new locale:

1. Create `packages/i18n/messages/<locale>.json`
2. Add locale to `packages/i18n/src/index.ts`
3. Update `next-intl` config in `apps/web/`
4. Submit PR with at least the login + dashboard pages translated

Currently supported:

- 🇺🇸 English (`en`)
- 🇹🇭 Thai (`th`)

We'd especially love help with: 🇯🇵 Japanese, 🇰🇷 Korean, 🇻🇳 Vietnamese, 🇮🇩 Indonesian, 🇨🇳 Chinese.

---

## Release Process

Releases are managed by the core team via [Changesets](https://github.com/changesets/changesets):

1. PR with code change → add a changeset: `pnpm changeset`
2. Core team reviews and merges
3. CI creates a "Version Packages" PR
4. Core team merges that PR → publish to npm + GitHub release

For v0.x.y releases, we publish the `@omyxia/*` packages to npm and tag Docker images.

---

## Architecture Decision Records (ADRs)

Significant design decisions are documented in [`docs/adr/`](docs/adr/). When proposing a major architectural change:

1. Copy `docs/adr/template.md` to `docs/adr/NNNN-your-decision.md`
2. Fill in: Context, Decision, Consequences, Alternatives Considered
3. Submit PR — discussion happens in the PR review

---

## Community

- 💬 [GitHub Discussions](https://github.com/open-uppu/omyxia/discussions) — questions, ideas, show-and-tell
- 🐛 [GitHub Issues](https://github.com/open-uppu/omyxia/issues) — bug reports, feature requests
- 🔒 [security@openuppu.example](mailto:security@openuppu.example) — private security reports only

---

## License

By contributing to Omyxia, you agree that your contributions will be licensed under [AGPL-3.0](LICENSE).

Thank you for making Omyxia better! 🙏