# Grainlab agent context

This directory preserves the stable product intent, behavioral contracts, and technical reasoning that shaped Grainlab. It exists so future work does not depend on reconstructing decisions from old conversations or accidentally undoing a previously solved problem.

## Reading order

Always read `AGENTS.md` first. Then load only the context relevant to the task:

| Task area | Required context |
|---|---|
| Product direction, new features, scope, naming, or UX hierarchy | `product-context.md` |
| Window chrome, zoom, pan, crop, history, import, responsive UI, or input behavior | `interaction-contracts.md` |
| Film stocks, color, grain, halation, shaders, processing, or rendering quality | `film-emulation.md` |
| Builds, packaging, generated files, repository structure, upstream template work, or validation | `engineering-workflow.md` |

Most significant features touch two documents. A rendering control, for example, should be checked against both the product intent and the physical film model.

## Sources of truth

Use these in descending order when documents appear to disagree:

1. The user’s newest explicit instruction.
2. `AGENTS.md` and the contracts in this directory.
3. `FEEDBACK.md`, which records specific corrections and failure modes.
4. Current repository behavior and tests.
5. README and feature documentation.

If code and a documented contract diverge, do not silently assume the code is intended. Determine which side reflects the newest explicit decision and update the other side as part of the change.

## What belongs here

Add information that will matter across multiple future tasks:

- product principles and explicit non-goals;
- interaction behavior users will notice or depend on;
- physical or architectural boundaries that prevent plausible but incorrect implementations;
- generated-file ownership and release validation;
- known failure modes that previously required correction.

Do not add temporary task status, raw conversation transcripts, machine-specific temporary paths, speculative ideas presented as commitments, or duplicated source code. Link to canonical files when exact schemas or implementations already exist.

## Maintenance rule

When a user changes one of these decisions, update the relevant context file in the same change. If the change is a correction to prior agent behavior, also add the concise lesson to `FEEDBACK.md` as required by `AGENTS.md`.
