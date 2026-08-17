# validate-sred — sred capability validator

Composed with `project-state validate` per `CAPABILITY-PLUGINS.md` §6: runs when the `sred`
capability is enabled, and may only fail records in the `sred` namespace. Normative source:
`docs/SRED-CAPABILITY-SPEC.md` §7.

## Checks

| # | Check | Severity |
|---|---|---|
| 1 | YAML parse + schema shape for every file under `sred/uncertainties/`, `sred/experiments/`, `sred/advancements/`, `sred/cost-tracking/` | fail |
| 2 | ADV without ≥1 linked TU **and** ≥1 linked EX | fail |
| 3 | EX without exactly one linked TU | fail |
| 4 | Dangling references: TU→EX, EX→ADV, or entity→milestone ids that don't resolve | fail |
| 5 | Evidence-log entries referencing nonexistent TU/EX ids | fail |
| 6 | `state/sred.json` FY entries whose `hard_deadline`/`target_date` ≠ `fy_end` + 18/15 months | fail |
| 7 | TU `identified_date` after any linked EX `start_date` (backdating appearance) | warn |
| 8 | EX with no `evidence_records` and no confirmed evidence-log entries | warn |
| 9 | EX completed >90 days ago with no linked ADV | warn |
| 10 | Evidence gap >30 days for an active EX | warn |
| 11 | `backfilled: true` entries exceed 25% of a FY's evidence | warn |
| 12 | Enabled `version:` in the manifest block ≠ installed plugin version | warn |
| 13 | Evidence entry with `logged_at - date > 7 days` and no `backfilled: true` | fail |
| 14 | `sred/inbox/` candidate stubs older than 90 days (capture discipline decaying) | warn |
| 15 | `sred/criteria.yaml` parse + schema shape; an area listed in both `candidate_uncertainty_areas` and `declared_routine` | fail |
| 16 | Criteria contradicting Layer 0 (`schema/eligibility-baseline.yaml`) — e.g. a candidate area matching `not_eligible_regardless_of_criteria` | fail |
| 17 | Criteria `status: draft` older than 90 days, or `last_refreshed` older than 2 quarters | warn |
| 18 | TU whose `linked_milestones` fall in a `declared_routine` area (criteria and capture disagree — one of them is wrong) | warn |

## Output

Standard validator report shape: `{fail: [...], warn: [...]}` per record, merged into the
core `project-state validate` report under the `sred` section. Warn items feed the tracker's
`gap_analysis()` prioritization; they are the same rules at different enforcement strength.
