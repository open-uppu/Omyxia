# Incident Response Runbook (v2.0.0)

> **SOC2 scope.** This document is the authoritative answer to SOC2
> CC7.3 ("the entity evaluates security events to determine whether
> they could or have resulted in a failure to meet objectives") and
> CC7.4 ("the entity responds to identified security incidents by
> executing a defined incident response program"). It covers the
> v2.0.0 Omyxia deployment, including the admin console, the Stripe
> billing module, the P5.2 WORM audit log, and the new self-service
> upgrade modal.
>
> **Activation.** Any of the following trigger an incident:
>   - PagerDuty alert from monitoring (severe + critical only)
>   - Customer report of unauthorized data access or modification
>   - SOC2 auditor finding / penetration-test report (medium+ severity)
>   - Whistleblower report (anonymous channel: `security@omyxia.app`)
>   - Detection of tampering on the WORM audit chain
>
> **One-page summary.** On call? -> Bridge: `https://meet.omyxia.app/incident`.
> Roles: Commander (1), Comms (1), Tech Lead (1), Scribe (1).
> Tool: PagerDuty primary + Slack `#inc-active` backup. Lo script:
> detect → contain → eradicate → recover → learn. Mandatory
> post-mortem within 7 days.

## Roles

| Role | Who | Responsibility |
|---|---|---|
| **Incident Commander (IC)** | The Omyxia on-call SRE (rotating weekly) | Owns the timeline, calls the severity, makes the go/no-go on customer comms |
| **Comms Lead** | Product / Customer Success | Owns status page, customer emails, regulator notifications |
| **Tech Lead** | Backend on-call | Owns the technical investigation, mitigation, and fix |
| **Scribe** | Whoever is free (rotates) | Owns the running incident log; everything said on the bridge goes into the doc within 60 s |
| **Security Advisor** | CISO (or designee) | Owns the threat-model call (data breach? integrity? availability?), the GDPR/PIPEDA disclosure clock, and the law-enforcement interface |
| **WORM Audit Lead** | Backend on-call | Owns validating the WORM audit chain integrity post-incident (replay) |

The IC can pull in additional roles ad hoc (e.g., "we need the DBA
team to drop the super-admin session table"). Smaller incidents are
handled by just IC + Tech Lead; the CISO is only paged at Sev 1+
incidents.

## Severity levels

| Sev | Definition | Examples | Response time | Comms within |
|---|---|---|---|---|
| **Sev 1** | Active exploitation; customer data exposed; WORM chain integrity broken | Stolen super-admin token, S3 bucket compromised, audit-row tampering detected, ransomware | 15 min | 30 min |
| **Sev 2** | Degraded security posture; no customer-data exposure yet | Force-disable MFA, RLS regression in a single controller, signature rotation overdue | 1 h | 4 h |
| **Sev 3** | Bug found; no exploit in the wild | Pen-test medium finding, dependency CVE without exploit code | 1 business day | next business day |
| **Sev 4** | Documentation / hardening nit | Missing rate limit on a non-PII endpoint, hardening checklist item incomplete | 1 week | end of week |

Customer-data exposure automatically scales the incident to Sev 1.
A WORM chain integrity break automatically scales to Sev 1 even if
no actual exposure is known — the chain is the integrity control
and breaking it is a control failure.

## Process

```
[1] DETECT     [2] CONTAIN    [3] ERADICATE [4] RECOVER [5] LEARN
   t=0           t=15m           t=2-24h        t=24-72h    t=72h+
```

### 1. Detect

Sources, in order of escalation speed:
1. **Automated PagerDuty alert** — `severity=critical` PagerDuty rules
   trigger a page within 5 min. Pager integration in
   `infra/observability/alerts/`.
2. **Customer report** — support@omyxia.app or in-app "Report a
   problem" widget. Tagged "security" routes to the incident Slack
   channel within 30 min.
3. **Auditor / pen-tester** — the SOC2 auditor hotline at
   `auditor@omyxia.app` (read by the CISO).
4. **WORM replay** — the monthly chain-integrity replay detects silent
   tampering. See `scripts/audit-snapshot.ts verify`.

Any detection opens a new incident. The IC opens a PagerDuty incident
and starts a bridge. Bridge URL: `https://meet.omyxia.app/incident-<id>`.

### 2. Contain

The goal is to **stop the bleeding** as fast as possible, even at
the cost of customer-facing degradation.

| Threat | Containment action | Recovery time |
|---|---|---|
| Stolen JWT | Invalidate `jti` blacklist via Redis (`AUTH_TOKEN_REVOKE_ALL=true` env); rotate `JWT_SECRET` | < 5 min |
| Stolen super-admin token | Same as above + rotate all admin passwords in `User` | < 15 min |
| Compromised DB credential | Rotate in Vault; restart API pods | < 10 min |
| Compromised S3 access key | `aws iam delete-access-key` + `aws s3api delete-object` on the lockable objects (will fail in COMPLIANCE — that's the point) | < 15 min |
| Compromised Stripe webhook secret | Rotate in Stripe dashboard + env | < 10 min |
| WORM tampering detected | **NO containment.** The S3 bucket + the trigger refuse to let it through. Verify the chain, do not delete the offending row, capture for forensics | n/a |
| Rate-limit / DoS | Cloudflare "Under Attack" mode + pause webhook receivers | < 5 min |

After containment, the Tech Lead opens a parallel investigation tab
in the incident doc; the Scribe starts a timeline (see template).

### 3. Eradicate

Identify the root cause and remove it. Common patterns:

- **Bad deploy** — `kubectl rollout undo` to the previous known-good
  image tag. Keep the old images in the registry for 30 days for
  post-mortem analysis.
- **Bad config change** — `git revert` + redeploy; `kubectl rollout
  restart` to apply the revert cleanly.
- **Dependency CVE** — pin to a patched version, regenerate
  `pnpm-lock.yaml`, redeploy.
- **Malicious actor inside** — see "Insider threat" section.

The WORM audit log + chain gives us a **cryptographically-attested
timeline** of who did what. Replay the chain, identify the action
window, and lock the account. **Do NOT clear the WORM log** — the
SOC2 auditor and the legal team will need it intact.

### 4. Recover

Restore customer-facing service and confirm the threat is gone.

- Re-enable the disabled endpoints / rate limits.
- Issue new JWTs (rotation invalidates all existing tokens).
- Tell customers what happened (see Comms section).
- Confirm the WORM chain still validates from the snapshot of the day
  before the incident to the day after.

### 5. Learn

Mandatory post-mortem within 7 days for Sev 1+ incidents. Output goes
to `docs/postmortems/YYYY-MM-DD-<short-name>.md` with this template:

```markdown
# Post-Mortem: <incident title>

- **Date:** YYYY-MM-DD
- **Sev:** 1
- **IC:** <name>
- **Tech Lead:** <name>
- **Customer data affected?** Yes / No / Unknown
- **Detection source:** <PagerDuty / customer / auditor / chain-replay>
- **Time-to-detect:** 5 min
- **Time-to-contain:** 32 min
- **Time-to-recover:** 4 h
- **Time-to-learn (this doc):** 5 days

## Summary
<one-paragraph explanation>

## Impact
<customer-facing impact, regulator-flagged data classes affected,
downtime minutes>

## Root cause
<the 5-why>

## What went well
<bullet list>

## What went wrong
<bullet list>

## Action items
- [ ] <owner>: <action> (<due date>)
- [ ] <owner>: <action> (<due date>)
```

The action items are tracked in the team backlog; the post-mortem
ship with `STATUS: in-progress` and are stamped `STATUS: complete`
when all items land in production.

## Comms

| Audience | When | How |
|---|---|---|
| Internal (full company) | At incident open | Slack `#general` one-liner |
| Customer Success | At Sev 2+ | Slack `#cx-active` + the incident doc |
| End customers | At Sev 1+ (and Sev 2 if customer-visible) | Status page + transactional email |
| Regulators (GDPR / PIPEDA) | Within 72 h if PII exposure | CISO owns this, not IC |
| Law enforcement | If criminal action suspected | CISO + CEO jointly |
| Auditors | Next quarterly review, regardless of severity | Post-mortem attached to the SOC2 evidence binder |

### Status page templates

```
[Investigating] We are investigating reports of <symptom>. The
admin console and the workspace API may be intermittently
unavailable. Customer data has not been affected. Updates will
follow every 15 minutes.

[Identified] <one-paragraph root cause>.

[Resolved] <one-paragraph summary + customer action items>.

[Postmortem] Full writeup: <link>.
```

The wording is reviewed by Comms Lead before publish; in Sev 1+ the
CISO must approve before customer comms go out.

## WORM integrity incident playbook

This is the P5.2-specific addendum. If the daily snapshot replay
detects a chain break, the runbook is:

1. **Do not touch the WORM table.** The chain is the evidence. The
   application is explicitly forbidden from updating rows (the
   trigger will raise), and we do not bypass it for an incident.
2. **Open a Sev 1 incident** (the chain is the integrity control).
3. **Pull the most recent valid S3 snapshot**:
   ```bash
   aws s3 cp s3://$AUDIT_S3_BUCKET/audit-log/<date>/manifest-<stamp>.json ./manifest.json
   ```
4. **For each row in the snapshot**, recompute the signature and
   compare against the `.sig.jsonl.gz` sibling. The first row whose
   signature mismatches is the breach point. (Use
   `prisma/scripts/audit-snapshot.ts` with `--verify` mode.)
5. **Identify the access window** between the last good day and the
   breach day; pull Postgres query logs and CloudTrail for that
   window.
6. **If the breach is in the live DB only** (snapshot intact),
   restore `AuditLog` from the snapshot — the WORM trigger refuses
   `DELETE`/`TRUNCATE`, so we drop and recreate the trigger under a
   documented, ticketed maintenance window AND preserve the corrupted
   rows in a `_archive_` schema for forensic analysis.
7. **If the breach is in the S3 bucket** (Object Lock COMPLIANCE
   should make this impossible), escalate to AWS support immediately
   and trigger the legal-hold process — `aws s3api put-object-legal-hold`.

## Insider threat

When the suspected attacker is an Omyxia employee or a privileged
service account:

1. Page the CISO immediately. Do not loop in the suspected actor's
   manager or any team they have access to.
2. Disable the actor's IAM and SSH credentials simultaneously. Use the
   `aws iam delete-access-key` + `kubectl delete certificate` sequence
   for the actor's infra identities.
3. Pull their auth + activity history via CloudTrail + the WORM audit
   log. The chain hash verifies the log is intact even if the actor
   tried to scrub their trail.
4. Legal + HR take over; engineering does not engage further on the
   human-resources side.

## Self-host customer assistance

When a self-hosted customer opens an incident with us:

1. Open the incident in our tracker (`#cust-incidents` Slack).
2. **Refuse to ask for their AUDIT_HMAC_SECRET or DB credentials.**
   We can give playbook suggestions against the OSS artifacts they
   already have on disk (`scripts/audit-snapshot.ts` can be replayed
   independently of their secrets with a verifier-mode flag).
3. The CSM is the single point of contact for the customer's
   comms with the affected end users.

## Roles & on-call

| | Primary | Backup |
|---|---|---|
| **Incident Commander** | Omyxia SRE on-call | Senior engineer (rotating) |
| **Comms Lead** | Product / CS | Engineering manager |
| **Tech Lead (API)** | Backend on-call | Senior backend engineer |
| **Tech Lead (DB)** | DBA on-call | Backend on-call |
| **Tech Lead (infra)** | Platform on-call | SRE on-call |
| **Security / CISO** | CISO | Designated senior SRE |
| **WORM Audit Lead** | Backend on-call | DBA |

The on-call rota lives in PagerDuty. Each rotation is one week
(UTC Monday 00:00 → following Monday 00:00). handoff includes:
   - read the open incident doc
   - skim last week's Sev 2+ incidents
   - verify the WORM chain replay script runs (sanity check)

## Appendix — Forbidden actions during an incident

| Forbidden action | Why |
|---|---|
| Disabling the WORM trigger | Loses tamper-evident evidence |
| Modifying `AuditLog` rows directly (even via SQL) | Same |
| Deleting any S3 WORM snapshot object | Object Lock refuses; if it succeeds, that's a control failure |
| Sharing the bridge outside the named participants until cleared by CISO | Reduces the attack surface of the social-engineering channel |
| Publishing the root cause before the CISO signs off | Legal holds / regulator requirements take precedence |
| Rewriting the post-mortem after publish without a `reopened:` header | The audit binder must match what was filed |

The forbidden-actions list lives on the bridge landing page so every
incident starts with it visible.
