# Architecture Cleanup Program

This is the durable operating guide for simplifying Letter Archive without adding
features. It exists so a long-running agent can resume from repository state instead
of relying on chat history or memory.

The mutable checkpoint is in [current-work.md](current-work.md). Read that file before
starting a cleanup slice. The current backend processing topology is mapped separately
in [processing-ownership.md](processing-ownership.md).

## Goal

Make ordinary changes safer and easier by reducing duplicated state, ambiguous
ownership, hidden coupling, and unverified behavior.

Success is not a larger number of components or uniformly small files. A large,
cohesive module can remain large. A cleanup is valuable when it creates one clear
owner for an invariant, removes a competing path, or establishes a reliable boundary
that tests can exercise.

## Constraints

- Do not add product features.
- Preserve public behavior unless a slice explicitly characterizes and fixes a
  correctness defect.
- Avoid repository-wide rewrites and speculative frameworks.
- Prefer deletion, consolidation, named domain operations, and pure adapters over
  generic abstraction layers.
- Do not combine a behavior change with an unrelated structural refactor.
- Keep the centralized frontend API client, Zod request validation, Drizzle, and the
  modular-monolith deployment model unless measured evidence justifies a change.
- Never weaken a test merely to make a check green. Update a test only when the old
  assertion is demonstrably stale and the replacement expresses the real contract.

## The Loop

Each pass changes one ownership boundary and ends in a recoverable commit.

1. **Resume**
   - Read `current-work.md`, inspect `git status`, and identify the last green commit.
   - Preserve any pre-existing user changes. Do not assume an unexplained dirty file
     belongs to the current pass.
2. **Orient**
   - Measure the problem and trace its owners, callers, side effects, and tests.
   - Rank work by correctness risk, blast radius, and how much future work it unlocks.
     File length alone is not a priority signal.
3. **Frame one slice**
   - Record the problem, invariant, scope, non-goals, acceptance checks, and likely
     rollback point in `current-work.md`.
   - Split the slice if it crosses more than one domain or changes more than one
     externally observable behavior.
4. **Establish ground truth**
   - Run the narrow existing check first.
   - Add a characterization or architecture-boundary test before moving behavior when
     the invariant is not already executable.
5. **Implement the smallest coherent change**
   - Move responsibility to its intended owner, remove the competing path, and avoid
     opportunistic cleanup outside the framed scope.
6. **Verify from narrow to broad**
   - Run focused tests first, then the relevant package suite, typecheck/build, and a
     browser check for user-interface behavior.
   - Use deterministic code-based checks as the primary ground truth. Add human or
     model review for architectural judgment, not as a substitute for tests.
7. **Evaluate the diff**
   - Ask whether ownership is clearer, the old path is gone, tests express behavior
     rather than implementation trivia, and the change introduced less complexity
     than it removed.
   - Use an independent reviewer for concurrency, data integrity, broad contracts, or
     cross-domain changes. After two failed revision attempts, stop tweaking and
     reframe the slice.
8. **Checkpoint**
   - Update `current-work.md` with exact evidence and remaining risk.
   - Commit only a green, reviewable checkpoint with a plain commit message.
   - Select the next smallest high-leverage slice and repeat.

## Priority Order

Choose work in this order:

1. Data loss, duplicate work, concurrency, security, or invalid lifecycle states.
2. Red or dishonest regression gates.
3. State models or control paths where one change must be repeated in many places.
4. Missing domain seams that cause duplicated business rules.
5. Dead code, dependency drift, documentation drift, and cosmetic organization.

Within a priority level, prefer the slice with the smallest safe change surface and
the clearest automated acceptance checks.

## Verification Policy

A completed slice must record:

- the focused command and result;
- the broader regression command and result;
- typecheck/build or lint evidence relevant to touched code;
- browser evidence for a changed UI contract;
- known residual risk and the next slice that addresses it.

The aggregate local command is `./scripts/verify-all.sh`. Existing lint debt remains
visible in `current-work.md` until it can become a zero-error required gate; rules must
not be disabled to manufacture a green result.

## Autonomous Boundaries

The loop may independently edit, test, document, and commit behavior-preserving
cleanup and characterized correctness fixes. Pause only when work requires:

- a product decision that changes what users can do or see;
- destructive data migration or irreversible external action;
- new infrastructure, credentials, spending, or deployment authority;
- choosing between incompatible public API contracts without repository evidence.

When blocked, record the evidence and pursue safe independent work. Do not repeatedly
retry the same failed approach.

## Research Basis

The loop deliberately uses a small number of composable practices rather than a new
agent framework:

- OpenAI's [Harness engineering](https://openai.com/index/harness-engineering/)
  (February 11, 2026) reports that repository-local plans, mechanically enforced
  architecture, and continuous small cleanup are what make higher autonomy durable.
- OpenAI's [Using PLANS.md for multi-hour problem solving](https://developers.openai.com/cookbook/articles/codex_exec_plans)
  (October 7, 2025) treats an execution plan as a self-contained living artifact with
  progress, discoveries, decisions, acceptance evidence, and restart instructions.
- OpenAI's [Unrolling the Codex agent loop](https://openai.com/index/unrolling-the-codex-agent-loop/)
  (January 23, 2026) describes the core observe-act-feedback loop and automatic context
  compaction used for longer work.
- OpenAI's [Symphony orchestration specification](https://openai.com/index/open-source-codex-orchestration-symphony/)
  (April 27, 2026) treats work as a recoverable state machine with reconciliation,
  explicit terminal reasons, bounded concurrency, and retry/backoff.
- Anthropic's [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
  (December 19, 2024) recommends simple composable patterns, environmental ground
  truth, stopping conditions, selective parallel workers, and evaluator-optimizer
  loops only where criteria are clear.
- Anthropic's [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
  (September 29, 2025) recommends progressive disclosure, structured notes,
  compaction, and just-in-time retrieval for long-horizon work.
- Anthropic's [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
  (November 26, 2025) reports that one-slice-at-a-time work, clean git checkpoints,
  durable progress notes, and end-to-end browser testing reduced half-finished work
  and premature completion. It explicitly leaves multi-agent superiority unresolved.
- Anthropic's [Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps)
  (March 24, 2026) found that a separate skeptical evaluator can add value near the
  model's capability boundary, while also showing that harness pieces should be
  removed one at a time when stronger models make them unnecessary. This program uses
  independent review for risky boundaries, not as permanent ceremony for every edit.
- Anthropic's [Scaling Managed Agents](https://www.anthropic.com/engineering/managed-agents)
  (April 8, 2026) separates durable, recoverable session state from a replaceable
  harness because model-specific scaffolding goes stale. That supports keeping this
  loop's state in repository artifacts and tests rather than coupling it to one agent
  runtime.
- Anthropic's [Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
  (January 9, 2026) distinguishes regression gates from capability evaluation and
  recommends deterministic tests for coding outcomes.
- METR's [Task-Completion Time Horizons](https://metr.org/time-horizons/)
  (updated May 8, 2026) shows that success remains probabilistic and task-dependent,
  even as frontier agents handle longer software tasks. That supports small,
  self-contained slices instead of trusting one unbounded refactor run.
- [MirrorCode](https://arxiv.org/abs/2606.30182) (submitted June 29, 2026) provides
  recent evidence about very long autonomous coding runs, but its exact-output
  programs have precise visible and hidden end-to-end tests. Its strongest model
  scored 56% overall, and one large attempt cost about $2,600 over 19 days; this is
  evidence for exact oracles and recovery, not for an unbounded subjective refactor.
- The NeurIPS paper [SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering](https://papers.nips.cc/paper_files/paper/2024/file/5a7c947568c1b1328ccc5230172e1e7c-Paper-Conference.pdf)
  shows that concise tools, guardrails, and specific feedback materially affect coding
  agent performance.

These sources support the operating pattern; they do not prove that any agent can run
an open-ended cleanup without verification. The repository's tests and observed
runtime behavior remain the authority.
