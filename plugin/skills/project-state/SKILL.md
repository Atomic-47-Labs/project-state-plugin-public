---
name: project-state
description: "The shared memory of a grant-funded project. Read, write, or validate project state — manifest, current phase, milestones, decisions, risks, changes, people, documents, activity log. Trigger on 'what's the project state', 'record a decision', 'log this change', 'update milestone M03', 'who is on the steering committee', 'what phase are we in', 'append to activity log', 'check state health', 'validate the manifest', or any request that reads or writes `project-state/`. Also trigger automatically whenever another project-* skill (phase-gate, document-curator, milestone-manager, status-reporter, notifier, sc-meeting, claim-prep, change-register, orchestrator) needs to read or write state — they route through this one. Works for any `project-state/` found by walking up from cwd."
---

# Project State — the memory layer

## Purpose

Every `project-*` skill depends on this one. `project-state` is the *only* skill that reads and writes `project-state/` directly; every other skill expresses intent ("create milestone", "transition phase") and this skill enforces schema, concurrency, and logging.

Without this skill, state edits drift, two agents clobber each other on the shared drive, and the activity log stops being trustworthy.

## Finding `project-state/`

Walk up from the current working directory until a `project-state/manifest.yaml` is found. That directory is the project root. If none is found:
- If the user asked a read-only question, say so and stop.
- If the user asked to initialize, direct them to run `project-scaffolder` (or, while that skill isn't built, follow the BLUEPRINT.md in the project root).

```bash
# Locate state (pseudocode)
dir = cwd
while dir != "/":
  if exists(dir + "/project-state/manifest.yaml"): return dir + "/project-state"
  dir = parent(dir)
raise "No project-state/ found walking up from " + cwd
```

`$PROJECT_STATE_DIR`, when set, short-circuits the walk (the appliance runner and prototype installs use this).

## Substrate binding — one substrate, two transports

Some skills (today: `project-harvester`; the pattern is available to any `*-state` facility) can persist either to the local filesystem or to a remote project-state.app substrate. This skill owns the resolver; adopting skills route through it. Spec: `docs/HARVEST-CONNECTIVITY-ROADMAP.md` §3.

**Resolution (fail-safe toward local):**

1. If `$PS_ENDPOINT` is set AND a personal `ksm_` token is available (`$PS_TOKEN`, else `~/.config/project-state/token`) → **deposit binding**: reads/writes go over HTTPS to that endpoint, authenticated with the token. Identity is the token's email — server-resolved, never claimed.
2. Otherwise → **file binding**: root per "Finding `project-state/`" above. This is the default and the base case — a machine with no cloud config behaves exactly as documented in the rest of this file, and no skill may prompt the user about cloud setup.

**Rules (binding):**

- A project has **one** canonical substrate. A given machine is either file-local or deposit-remote for a project — never both. The deposit binding handles an unreachable endpoint by keeping the batch and retrying, then stopping with a report; it never falls back to writing local files (that forks the substrate).
- The five harvest persist verbs and their mappings live in `project-harvester`'s "Substrate binding" section (`read-context`, `seen?`/`mark-seen`, `write-doc`, `advance-cursor`, `append-activity`). On the deposit binding, locking, dedup, cursor advance, and activity logging are enforced server-side by the deposit module — the same write protocol in this file, executed by the app.
- Harvest cursors are file-per-entity at `harvest/cursors/{email}--{surface}.yaml` — one writer per file, no lock. The `state.json` advisory-lock protocol still applies to everything else.

## Schema

The canonical schema lives in `project-state/SCHEMA.md` *in the project itself*. This skill validates against that file; it does not carry its own schema because different projects may extend the schema for their specific needs.

Every entity YAML has common frontmatter:
- `id` (matches filename minus extension)
- `kind` (`milestone` | `objective` | `kpi` | `decision` | `risk` | `change-log` | `change-order` | `person` | `publication` | `ip-disclosure` | `sc-meeting` | `quarterly-claim` | `wiki-page`)
- `created`, `created_by`, `last_modified`, `last_modified_by` (ISO-8601 UTC)
- `phase` (phase this entity was created in)

**Wiki pages are the one exception to YAML-only:** `wiki/<slug>.md` is Markdown with a YAML frontmatter block (the body is prose with inline `[[links]]`). The validator accepts `.md` under `wiki/` and treats the frontmatter block as the entity record (common fields + `title`, `aliases`, `tags`, `parent`, `links`, `visibility`, `confidence`). The derived `wiki/.index/` is non-canonical and rebuildable (like `tracking/*.xlsx`) — excluded from validation.

Before every write, verify the document has all common frontmatter. Refuse to write if `id`, `kind`, or timestamps are missing.

## Operations

### Read operations (no locking needed)

**Get manifest.** Return parsed `manifest.yaml`.

**Get state.** Return parsed `state.json`.

**Get current phase.** `state.json:current_phase` → read `phases/<phase>/manifest.yaml`.

**Get entity.** Input: `kind` + `id`. Locate file by filename convention (see SCHEMA.md). Return parsed YAML.

**List entities.** Input: `kind`, optional filters (status, owner, phase). Return array.

**Tail activity log.** Input: `n=50`. Return last n lines of `logs/activity.ndjson` parsed.

**Count entities.** Return counters from `state.json`.

**Validate.** Walk every YAML/JSON in `project-state/`; confirm it parses and has required frontmatter. Report deviations; do not auto-fix.

### Write operations (with locking + logging)

For every write:

1. **Find lockfile.** Check `<target>.lock`. If it exists and its `acquired + ttl_seconds` is in the future, wait (up to 30 s) or abort.
2. **Acquire lock.** Write `<target>.lock` = `{actor, acquired, ttl_seconds: 300}`.
3. **Read current state** of the target if it exists.
4. **Check staleness.** If the caller passed a `base_last_modified` and the current file's `last_modified` is newer, return a CONFLICT to the caller. Do not overwrite.
5. **Apply the change.** Update `last_modified`, `last_modified_by`, fields under change. Preserve all other fields.
6. **Write the file.**
7. **Release lock.** Delete `<target>.lock`.
8. **Append to activity log.** One NDJSON line with `ts, actor, event, id, summary`.
9. **Update state.json counters** if creating a new entity (also under the lock).

### Canonical write events

| Operation                           | Event name                  | Also bumps counter     |
| ----------------------------------- | --------------------------- | ---------------------- |
| Create milestone                    | `milestone.created`         | `counters.milestones`  |
| Update milestone                    | `milestone.updated`         | —                      |
| Complete milestone                  | `milestone.completed`       | —                      |
| Create objective                    | `objective.created`         | `counters.objectives`  |
| Update objective                    | `objective.updated`         | —                      |
| Create KPI                          | `kpi.created`               | `counters.kpis`        |
| Update KPI                          | `kpi.updated`               | —                      |
| Add a dated KPI reading             | `kpi.reading.added`         | —                      |
| Open a decision (owed, not yet made) | `decision.opened`          | `counters.decisions`   |
| Record / resolve decision           | `decision.recorded`         | `counters.decisions` on new |
| Propose a stop                      | `stop.proposed`             | `counters.stops`       |
| Confirm / reject stop               | `stop.stopped` / `stop.rejected` | —                 |
| Log change (non-material)           | `change.logged`             | `counters.change_log_entries` |
| Draft change order                  | `change-order.drafted`      | `counters.change_orders` |
| Submit change order                 | `change-order.submitted`    | —                      |
| Approve change order                | `change-order.approved`     | —                      |
| Open risk                           | `risk.opened`               | `counters.risks`       |
| Close/materialize risk              | `risk.closed` / `risk.materialized` | —              |
| Register document                   | `document.registered`       | —                      |
| Promote to source-of-truth          | `document.sot.promoted`     | —                      |
| Schedule SC meeting                 | `sc.meeting.scheduled`      | `counters.sc_meetings` |
| Hold SC meeting / distribute minutes | `sc.meeting.held` / `sc.minutes.distributed` | —    |
| Draft claim / submit / paid         | `claim.drafted` / `claim.submitted` / `claim.paid` | `counters.quarterly_claims` on draft |
| Phase transition                    | `phase.transition`          | —                      |
| IP disclosure                       | `ip.disclosed`              | `counters.ip_disclosures` |
| Publication proposed / approved     | `publication.proposed` / `publication.approved` | `counters.publications` on proposed |
| Generate report                     | `report.generated`          | —                      |
| Health assessed                     | `health.assessed`           | —                      |
| Create wiki page                    | `wiki.page.created`         | `counters.wiki_pages`  |
| Update wiki page                    | `wiki.page.updated`         | —                      |
| Delete wiki page                    | `wiki.page.deleted`         | —                      |
| Publish wiki page (after review)    | `wiki.page.published`       | —                      |
| Rebuild the derived wiki index      | `wiki.graph.rebuilt`        | —                      |
| Broken entity reference detected    | `wiki.link.broken`          | —                      |

Event names are lowercase, dot-separated, noun.verb.

## Concurrency discipline (from CONCURRENCY.md)

- **File-per-entity** — never fuse `milestones.yaml` or `decisions.yaml`. Each entity is its own file.
- **Advisory lockfiles** with 5-minute TTL on `manifest.yaml`, `state.json`, and `tracking/*.xlsx`.
- **Append-only logs** — never rewrite `logs/*.ndjson`; correct with new entries.
- **Deterministic filenames** — two agents creating the same entity produce the same filename.

## What this skill does NOT do

- **Does not make project decisions.** Doesn't decide if a change is material (that's `project-change-register`) or if a phase gate is clearable (that's `project-phase-gate`).
- **Does not generate reports.** Just returns data (that's `project-status-reporter`).
- **Does not send notifications.** Just writes activity events (that's `project-notifier`).
- **Does not classify documents.** Just reads/writes `documents/index.yaml` (that's `project-document-curator`).

## Examples

### "What phase are we in?"
Read `state.json:current_phase`. Read `phases/<phase>/manifest.yaml`. Return phase label + gate-out checklist with done/pending counts.

### "Update M03 percent complete to 35%"
1. Load `milestones/M03-cdi-pilot-fermentation-trials.yaml`.
2. Set `percent_complete: 35`. Update `last_modified`. Keep `technical_progress` unchanged (caller didn't provide it).
3. Acquire lock, write, release, log `milestone.updated` with `id: M03-...`.
4. Return the updated entity.

### "Track a goal / KPI" (objectives + key results — the outcome layer)
Objectives and KPIs are file-per-entity like everything else; `project-goal-tracker` is the
verb skill, but the writes land here.
1. **Objective** — write `objectives/O<NN>-<slug>.yaml` (next `NN`) with `kind: objective`, `title`, `horizon`, `category`, `status`, optional `narrative`/`key_results`/`milestones`/`confidence`/`target_date`. Log `objective.created`, bump `counters.objectives`.
2. **KPI** — write `kpis/KPI-<NN>-<slug>.yaml` with `kind: kpi`, `metric`, `unit`, `baseline`, `target`, `current`, `direction` (up|down), `cadence`, optional `delivers_to` (objective id). Log `kpi.created`, bump `counters.kpis`.
3. **Reading** — append `{date, value, note?}` to the KPI's `history` (one entry per date — replace same-day), set `current` and `as_of`. Log `kpi.reading.added`. Never rewrite prior readings; corrections are a new same-date entry.
4. Attainment (direction-aware `baseline→target`) and trend (last two readings) are **computed on read** — never store them.

### "Record a decision: engage ACME as subcontractor for M03"
1. Receive `decision.recorded` payload with id, date, title, context, options, decision, rationale, material_change.
2. Validate required fields. If `material_change: true`, cross-reference `change_order_ref` and warn if absent.
3. Write `decisions/<date>-<slug>.yaml`. Append to `logs/activity.ndjson` and `logs/decisions.ndjson`.
4. Bump `state.json:counters.decisions`.
5. If `material_change: true`, remind the caller that `project-change-register` should draft the CO.

### "Open a decision" (a decision that's owed but not yet made)
An open decision is a normal decision record in the `open` state — same `decisions/` directory, no new entity type.
1. Receive a `decision.opened` intent with `title`, `question` (required), and optional `options`, `owner`, `needed_by`, `blocks`, `context`.
2. Write `decisions/<date>-<slug>.yaml` with `kind: decision`, `status: open`, the `question`, `owner`, `needed_by`, `blocks` (list), `options` (list), plus standard frontmatter. Leave `decision`/`rationale` empty until resolved.
3. Acquire lock, write, release, log `decision.opened` with `id`. Bump `counters.decisions`.
4. Resolving it later is a `decision.recorded` update on the same file: set `status: decided`, fill `decision`/`rationale`, keep the `id`. (Existing decisions with no `status` are treated as `decided`.)

### "Propose a stop" (work / practice / low-value report to retire)
1. Receive a `stop.proposed` intent with `title`, `target` (what to stop), `why` (all required), and optional `evidence`, `in_favor_of`, `owner`.
2. Write `stops/STOP-<NN>-<slug>.yaml` (next `NN` like risks) with `kind: stop`, `status: proposed`, `target`, `why`, `evidence` (list), `in_favor_of`, `owner`, plus standard frontmatter.
3. Acquire lock, write, release, log `stop.proposed` with `id`. Bump `counters.stops` (create the counter if absent).
4. A later confirm/reject sets `status: stopped` or `status: rejected` and logs `stop.stopped` / `stop.rejected`. The skill never decides *whether* to stop — it only records the proposal and the operator's call.

### "Show me recent activity"
Tail `logs/activity.ndjson`. Default to last 50 events. Pretty-print with timestamp + actor + event + any `id`/`summary`.

### "Validate the state"
Walk every YAML/JSON, parse, check frontmatter completeness. Report:
- Files that don't parse
- Entities missing `id`, `kind`, or timestamps
- Filename-id mismatches
- Orphan references (e.g., a decision pointing to a nonexistent change-order)
- Stale lockfiles (older than TTL)

Return a summary; never auto-fix.

## Reference files

- `references/field-enums.yaml` — canonical enum values for `status`, `classification`, `kind`, etc.
- `references/write-protocol.md` — detailed step-by-step write protocol with code-like pseudocode.

(These reference files are optional; if missing, the above instructions in SKILL.md are self-sufficient.)
