# validate-intel — the intel capability's validator

Composed with the core validator by `project-state validate`; may fail only records in
the `intel` namespace (CAPABILITY-PLUGINS.md §6). Checks, in order:

1. **Enablement coherence.** `capabilities.intel` block present and `enabled: true|false`
   well-formed; `focus` non-empty and not the literal `REQUIRED`; `version:` compared to
   the installed plugin version — warn on drift, never fail.
2. **Directory shape.** `intel/{entities,signals,mandates,network,reports}` exist;
   `intel/agenda.yaml` parses; `state/intel.json` parses.
3. **Ids and counters.** Every file matches its kind's id format (`INT-E-NNN` etc.);
   filename equals `id:`; `state/intel.json` counters ≥ the highest id seen — fail on a
   counter behind the files (id collision risk), warn on a counter far ahead.
4. **Required fields and enums** per `schema/entities.yaml`, with `type` validated against
   the manifest block's declared `entity_types` / `mandate_types`.
5. **References.** Every `entities_referenced[]` id and every mandate `entity_id` resolves
   to an existing entity — fail on orphans. `became:` targets resolve to existing risks,
   decisions, or registered documents — warn on orphans (the target may live in a
   not-yet-pulled branch).
6. **Append-only signals.** A signal whose content hash changed after creation (where the
   host tracks it) or whose `created:` postdates a referencing record is flagged. The
   convention is supersede-with-reference, never edit.
7. **Agenda hygiene.** Every question marked answered cites at least one signal id that
   exists.


## Competitive layer (intel 1.1 — docs/INTEL-CI-SPEC.md §6)

8. **Competitive block.** `competitive.self_entity`, when set (scalar or one-element list),
   resolves to an entity of type `self`; every `competitors[]` id resolves; `half_lives_days`
   has an entry for every category in use across `intel/claims/`.
9. **Claims.** Required fields and enums per `schema/entities.yaml` (`intel-claim`);
   `subject.entity` resolves; `material: true` requires `source.ref` and either `excerpt` or
   `epistemic_status: unknown`; `verified` requires a source class other than `inference`;
   `derived_from`, when set, resolves to a signal; `retrieved_at` ≥ `source_date`.
10. **Supersession integrity.** Every `supersedes` target exists, is older, and the chain has
    no cycle; a superseded claim is not cited as current by a projection whose
    `generated_at` postdates the supersession — fail.
11. **Conflicts symmetric.** `conflicts_with` appears on both claims — fail on a one-sided
    conflict; list contested categories, do not resolve them.
12. **Append-only claims and changes.** Content hash unchanged since creation where the host
    tracks it (as check 6 for signals).
13. **Projection citations.** For every file under `intel/profiles`, `intel/battlecards`,
    `intel/deals/*/brief.md`, `intel/reports/brief-*.md`: every `[INT-C-…]` in the body
    resolves; frontmatter `claims:` equals the set cited; a battlecard's
    `health.unsourced_lines` is 0; a file whose sha256 differs from
    `state/intel.json → projections[path].sha256` is a **fork** — warn, name the file, say
    "put the correction in the claim set and regenerate".
14. **Change events.** `before[]` are claims that are superseded; `after[]` are the claims
    that supersede them; `significance` is an enum value.
15. **Lineage.** `became:` on claims resolves like check 5 — warn on orphans.

Report findings plainly; fix nothing silently.
