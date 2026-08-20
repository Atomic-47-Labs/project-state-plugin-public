---
name: project-phase-gate
description: Manage lifecycle phase transitions for any project. v2.0 supports user-defined phase sets via presets in templates/phase-presets/ — grant-default (LOI→Approval→Planning→Execution→Closeout→Archive), agile-default (Discovery→Build-loops→Hardening→Release), waterfall-default, client-engagement-default (Discovery→Proposal→Engagement→Wrap), open-source-default (Incubation→Active→Maintained→Archived), or custom. Active pack can override gate-in/gate-out criteria per phase. Enforces required artifacts; refuses to transition if gate artifacts missing. v2.1 adds the lifecycle declaration (terminal | continuous) and the increment layer for facilities that continue past closeout — opening, closing, and freezing increments so phase re-entry never clobbers a prior pass's gate evidence. Use whenever the user says 'what phase are we in', 'can we move to execution', 'what's blocking the gate', 'transition to the next phase', 'gate status', 'gate checklist', 'this project doesn't end', 'we shipped v1 but there's a v1.1', 'close the increment', 'start the next increment', 'what did this closeout close', 'make this continuous', 'the project continues after closeout'.
---

# Project Phase Gate (v2.1 — user-defined phases, terminal or continuous)

Manages the lifecycle phase transitions of a project. Each phase has a gate-in (what must be true to enter) and a gate-out (what must be true to leave). The skill refuses transitions when gate artifacts are missing.

In v2.0, phase definitions are no longer hard-coded. They come from a preset (`templates/phase-presets/<preset-name>.yaml`) selected in the manifest, with optional overrides from active pack profiles.

## Available presets (ship in v2.0)

- **`grant-default`** — LOI → Approval → Planning → Execution → Closeout → Archive. Reproduces v1.x lifecycle. Used by grant projects (PIC, NSERC, NIH, EU Horizon, etc.).
- **`agile-default`** — Discovery → Build-loops (recurring) → Hardening → Release. For engineering teams running Scrum/Kanban with release trains.
- **`waterfall-default`** — Requirements → Design → Build → Test → Deploy → Maintain. For traditional waterfall projects.
- **`client-engagement-default`** — Discovery → Proposal → Engagement → Wrap. For consulting/client-services work.
- **`open-source-default`** — Incubation → Active → Maintained → Archived. For community-governed projects.
- **Custom** — write your own preset YAML; reference it from `manifest.yaml` as `phases.preset: "your-preset"`.

## Pack overrides

A pack can ship a `phase-gate.yaml` profile that adds or modifies gate criteria for a preset. Example: the PIC pack's profile augments `grant-default` with PIC-specific gate-in/gate-out criteria (e.g. "MPA signed by all parties" as planning gate-out). Loading the PIC pack adds those checks; loading no pack uses the bare preset.

## What it owns

- Reading the current phase from `state.json`
- Enforcing gate-in and gate-out checklists per the active preset + pack overrides
- Refusing transitions with clear errors when checklists are incomplete
- Writing transition events to `logs/activity.ndjson`
- Updating `state.json` on successful transitions
- **Declaring the lifecycle** — `set_lifecycle`, and the `convert_to_continuous` migration
- **The increment boundary** — opening, closing, and freezing increments in a continuous facility

## What it does not own

- Defining what the phases are — that's the preset
- Defining gate criteria — those are the preset + pack overrides
- Doing the work to satisfy a gate — that's other skills + humans
- Writing any file directly — every write routes through `project-state` for locking and logging
- Deciding whether a project continues — only the operator knows that

---

# The lifecycle (v2.1)

A phase ladder assumes the project ends. Most do. Some don't — a product ships and keeps shipping,
a retainer renews, an ops facility never closes. For those, the terminal ladder loses gate history on
phase re-entry, dilutes the rollup, and offers no correct forward move.

The lifecycle declaration says which kind of thing this facility is. Spec:
`docs/CONTINUOUS-LIFECYCLE-SPEC.md`.

## `get_lifecycle()`

**Resolution order: facility → pack default → `terminal`.**

1. `manifest.yaml:phases.lifecycle`, if set. The facility always wins.
2. Otherwise, `defaults.lifecycle` from the manifests of the loaded packs. If they disagree, **do not
   pick** — treat it as unset and fall through. A pack default is a *suggestion* consumed by
   `project-onboarding` to pre-fill its question; it is not a setting, and it must never silently make
   a facility continuous.
3. Otherwise `terminal`.

**Absence is not a gap.** Never warn about it, never suggest filling it in, never treat it as
unconfigured. A facility that never declares a lifecycle is a supported facility, permanently.

Return the resolved value *and* where it came from, so callers can tell a declared `terminal` from an
assumed one. `project-archive` and the post-closeout diagnostic both care about the difference: there is
no point warning a facility that already answered the question.

## `set_lifecycle(value)`

`terminal` | `continuous`. Refuse `continuous` when no phase in the active preset declares
`cycles_back_to` — that key marks the increment boundary, and without one there is nothing to close
an increment *at*. `grant-default` declares none by design, so:

```
grant-default is terminal by design — a submission ends with a deadline, a decision, and either an
award or a rejection. A grant project that continues is a new grant, not a new increment.
If this facility is not really a grant project, change phases.preset first.
```

Writes both `manifest.yaml:phases.lifecycle` and `state.json:lifecycle` through `project-state`, under
the manifest lock. Logs `lifecycle.declared`.

This operation exists because a key with no writer is a defect: see `FB-003`, where five phase presets
shipped and nothing ever wrote `phases.preset`, so selecting one meant hand-editing the manifest.

## Terminal facilities: nothing changes

Everything below activates only at `lifecycle: continuous`. On a terminal facility `transition_phase`
behaves exactly as it did in v2.0, `phases/` holds the only phase records, `state.json:gates` is the
only gate state, and no `increments/` directory is created. This is the compatibility contract in spec
§5, and it is verified rather than assumed.

---

# Increments (continuous facilities only)

**An increment is a bounded pass through the phase ladder that produces its own closure.** A facility
has one or many. `state.json:current_increment` names the open one.

The design decision worth knowing before reading further: **`phases/` does not move.** It remains the
live phase records of the *current* increment, at the facility root, in the shape it has always had.
Closing an increment freezes a *copy* into the increment's directory and resets `phases/` from the
preset. This is what keeps `current_phase` a scalar and `gates` keyed by phase id, so every existing
reader keeps working (spec §4.2).

## `open_increment(label)`

1. Refuse if `current_increment` is already set and open — one open increment at a time.
2. Allocate the next `INC-<NN>` from `state.json:counters.increments`.
3. Write `increments/INC-<NN>-<label>/manifest.yaml` with `status: open`, `opened: <today>`.
4. Reset `phases/` from the active preset: every phase back to `status: pending`, `started`/`ended`
   nulled, every `gate_out.checklist[].done` back to `false`, all `evidence` cleared. **Only safe
   because the outgoing increment's records were frozen first** — see `close_increment` step 5.
5. Clear `state.json:gates`, set `current_increment`, set `current_phase` to the `cycles_back_to`
   target of the phase that closed the previous increment (or the preset's first phase for `INC-01`).
6. Log `increment.opened`.

## `close_increment(closed_what, label_of_next?)`

The whole point of the design, and the operation that fixes the data loss.

1. Refuse unless the current phase's `gate_out` checklist is satisfied — same rule as any transition.
   A criterion may be closed `closed_unmet: true` with a reason; that satisfies the gate and is
   **preserved verbatim**, never rewritten.
2. **Refuse without `closed_what`.** No default, no generated text, no "same as last increment". Ask:

   ```
   What did this closeout close? One or two sentences. Say what it did NOT close too.

   Example, from CC4PS: "The loop: triage, dispatch, execute, reconcile — proven across fourteen
   workloads and packaged as a plugin. Does NOT close the product."
   ```

   This is the cheapest thing in the whole design and, on its own, removes most of the practical
   damage: it is what makes a later reopening legible as an increment rather than as an admission
   that the first closure was a formality.
3. Set `closed`, `phase_at_close`, `closed_what`, `status: closed` on the increment manifest.
4. If a closeout report was produced, record it at
   `increments/INC-<NN>-<label>/reports/closeout-<date>.md` (`project-archive` writes the file).
5. **Freeze.** Copy `phases/` → `increments/INC-<NN>-<label>/phases/` and `state.json:gates` →
   `increments/INC-<NN>-<label>/gates.json`. Copy, do not move. This is the step that preserves the
   first pass's gate checklist, its evidence pointers, and any criterion closed unmet.
6. Log `increment.closed`.
7. If `label_of_next` was given, `open_increment(label_of_next)` and set `succeeded_by`. Otherwise the
   facility sits with no open increment, which is a legitimate resting state — a product between
   increments has not ended, it is idle.

**Nothing rewrites a closed increment.** Not a later close, not a re-run, not a validator, not a
migration. If a closed increment's record is wrong, the correction is a new record, per the
append-only discipline in `CONCURRENCY.md`.

## `cancel_increment(reason)`

Sets `status: cancelled` and freezes exactly as `close_increment` does. An increment that was
cancelled is not one that closed, and recording it as closed recreates "the history says we went
backwards" one level down. `closed_what` is still required; for a cancelled increment it records what
was and was not delivered before the stop. Logs `increment.cancelled`.

**`cancelled`, not `abandoned`.** Milestones already use `cancelled` for this exact idea and one is in
live use in this repo's own facility. A second word for a concept the substrate already names is how a
vocabulary splits — the same way phase `status` ended up with three of them (`SCHEMA.md`, phase
manifest).

## `convert_to_continuous(label?)`

Lazy and non-destructive. There is no batch migration, no version bump that converts facilities, and
no startup check that rewrites state. Nothing happens until asked.

1. Write `phases.lifecycle: continuous` to the manifest; mirror to `state.json`.
2. Create `increments/INC-01-<label>/manifest.yaml` (`label` defaults to `v1`). **Everything the
   facility already has becomes increment 1.**
3. **If the facility is at or past its closeout-equivalent phase:** ask for `closed_what` (the one
   thing only a human knows), freeze `phases/` and `gates` into `INC-01`, mark it `closed`, then open
   `INC-02` and set `current_phase` to the boundary phase's `cycles_back_to` target.
   **If it is mid-flight:** `INC-01` stays `open`, nothing is frozen, no `closed_what` is needed yet.
4. If a `reports/final-report-<date>.md` exists, reference it from `closeout_report` **in place**. It
   is not moved and not renamed. The word *final* stays in the filename of the report that was, at the
   time, final.
5. Log `lifecycle.converted`, then `increment.opened` / `increment.closed` as applicable.

**No pre-existing record is edited.** One directory is created, two manifest keys are written, and
`phases/` is copied — never moved. Afterwards `state.json:current_phase` is read from the same place
as before, so a reader that knows nothing about increments sees a facility that is executing, exactly
as it would have.

## `revert_to_terminal()`

Symmetrical, for a facility with at most one increment: drop `lifecycle`, drop `current_increment`,
leave `increments/` on disk as inert history. Refuse when two or more increments have closed —
reverting would strand history that `phases/` cannot represent — and say so:

```
This facility has closed 3 increments. Reverting to terminal would leave their phase records
unreachable, because phases/ can only represent one pass. Nothing has been changed.
```

---

## Worked example — the case this was built for

A facility on `agile-default` reaches `04-release`, ships, and has a v1.1 to build.

**Before (terminal):** the only forward move is `05-archive`-equivalent, which is wrong, so the
operator reopens `02-build-loops`. That resets the release gate's checklist, discarding its evidence
and any criterion closed unmet, and the history records that the project went backwards.

**After (continuous):**

```
close_increment(closed_what: "v1: the loop proven across fourteen workloads and packaged as a
                             plugin. Does NOT close the product.",
                label_of_next: "v1.1")
```

- `increments/INC-01-v1/` now holds a frozen `phases/` and `gates.json`. The release gate's evidence
  survives, including `execution.spec_without_material_defect` closed unmet after six assessments.
- `phases/` is reset, `current_phase` is `02-build-loops`, `current_increment` is `INC-02-v1.1`.
- `health.overall_percent` still reads all-time; `health.increment.percent` reads v1.1 only.
- The activity log shows an increment closing and another opening — forward, which is what happened.

## Migration from v1.x

The skill name is unchanged. The hard-coded six-phase grant lifecycle moves to `templates/phase-presets/grant-default.yaml` (verbatim). Existing projects' `state.json` and phase records are unchanged. The PIC-specific gate criteria move to `packs/pic-pcais/profiles/phase-gate.yaml`.

A v1.x project loading the PIC pack and selecting `phases.preset: "grant-default"` gets identical behavior to v1.x. A non-grant project picks a different preset (or writes a custom one) and the same skill manages it.
