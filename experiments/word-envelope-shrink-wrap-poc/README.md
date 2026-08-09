# Word Envelope Shrink-Wrap POC

An isolated, deterministic experiment for converting a cleaned handwritten-word
ink mask into a smooth word envelope. It does not integrate with the production
API, database, or review UI.

The POC compares:

- `morphological`: angle-aware closing, distance padding, hole filling, contour
  extraction, topology-preserving simplification, and guarded Chaikin smoothing.
- `soft_union`: an oriented Gaussian soft union followed by the same guarded
  polygon post-processing and validation.

It also includes a small command-line cleanup tool for stable connected-component
IDs, keep/remove operations, positive and negative polygons or scribbles, and
component cuts. Every cleanup operation is stored as JSON.

Important: the wrapper knows geometry, not word ownership. It can safely reject many
bad shapes, but a cleaned mask that omits a true mark or retains the next word can
still produce a valid-looking false success. `LIMITS.md` documents the measured
boundaries and the required review policy.

## Runtime

No packages were installed for this experiment. It was developed with the
repository's existing Kraken environment:

```sh
PYTHON=/Users/masongalusha/Workspace/projects/letter-archive/backend/python/venv/bin/python
cd experiments/word-envelope-shrink-wrap-poc
PYTHONPATH=src "$PYTHON" -m unittest discover -s tests -v
PYTHONPATH=src "$PYTHON" -m word_envelope.cli --help
```

The minimal dependency list is recorded in `requirements.txt` for reproducibility,
but this POC does not create or modify an environment.

## Common commands

```sh
# Inventory and label connected components.
PYTHONPATH=src "$PYTHON" -m word_envelope.cli components \
  --mask path/to/raw-mask.png --output-dir path/to/inventory

# Apply a versioned cleanup operation file.
PYTHONPATH=src "$PYTHON" -m word_envelope.cli clean \
  --mask path/to/raw-mask.png --operations path/to/operations.json \
  --output-dir path/to/cleaned

# Wrap a cleaned mask with both deterministic approaches. Mask PNGs use the
# cleanup tool's black-background/white-ink convention.
PYTHONPATH=src "$PYTHON" -m word_envelope.cli wrap \
  --example-id example-name \
  --crop path/to/crop.png --raw-mask path/to/raw-mask.png \
  --cleaned-mask path/to/cleaned-mask.png --metadata path/to/crop.json \
  --operations path/to/operations.json --method both \
  --output-dir path/to/result

# Generate the synthetic suite and gallery.
PYTHONPATH=src "$PYTHON" -m word_envelope.cli synthetic \
  --output-dir artifacts/synthetic

# Characterize the safe operating range and known false-success cases.
PYTHONPATH=src "$PYTHON" -m word_envelope.cli limits \
  --output-dir artifacts/limits

# Replay the 20-case frozen real-word stress corpus serially.
PYTHONPATH=src "$PYTHON" -m word_envelope.cli stress-real \
  --manifest corpus/real-stress-v1.json \
  --output-dir artifacts/stress-real

# Generate hash-bound, blinded agent ownership packs.
PYTHONPATH=src "$PYTHON" -m word_envelope.cli agent-pack \
  --pilot corpus/agent-ownership-pilot-v3.json \
  --stress-manifest corpus/real-stress-v1.json \
  --stress-artifacts artifacts/stress-real \
  --prompt prompts/agent-ink-ownership-v2.md \
  --output-dir artifacts/agent-ownership-pilot-v3

# Copy only verified public evidence into a physically separate blind stage.
PYTHONPATH=src "$PYTHON" -m word_envelope.cli agent-stage \
  --packs artifacts/agent-ownership-pilot-v3 \
  --output-dir artifacts/agent-ownership-pilot-v3-public

# Expand one compact model decision into a state- and component-bound action.
PYTHONPATH=src "$PYTHON" -m word_envelope.cli agent-build-action \
  --task path/to/public/task.json --decision path/to/decision.json \
  --output path/to/bound-action.json

# Replay and score an exact blinded cohort against sealed development truth.
PYTHONPATH=src "$PYTHON" -m word_envelope.cli agent-evaluate-cohort \
  --tasks-root path/to/full-packs --actions-dir path/to/actions \
  --output-dir path/to/evaluation

# Rebuild the deterministic 007/014 supervisor-state demonstrations.
PYTHONPATH=src "$PYTHON" scripts/build_word_workflow_v1_demo.py

# Strictly replay and validate the recorded Terra supervisor-packet trial.
PYTHONPATH=src "$PYTHON" scripts/validate_word_workflow_agent_trial.py
```

See `DESIGN.md` for the geometry contract, `RESULTS.md` for envelope evidence,
`LIMITS.md` for measured geometry and semantic boundaries, and
`AGENT_WORKFLOW_RESULTS.md` for the Terra/Sol ownership, multi-turn, verifier, and
candidate-review experiments. `WORKFLOW_SUPERVISOR_V1.md` documents the new
one-current-item control plane, the 007/014 navigation trial, and the remaining
integration work before another full-page run. `HUMAN_REVIEW_CONSOLE.md` explains
the local, human-friendly console for taking the agent's exact seat while recording
packet-bound notes, screenshots, and workflow friction.
