# Amadeus 1.6.2 — Stability Cleanup Goal

Date: 2026-09-27

## Status

- Target release: `1.6.2`
- Canonical base: `main`
- Current released version at planning time: `1.6.1`
- Agent runtime: OpenClaw only
- TTS production backend: existing accepted `A / MLX 1.7B 8-bit / Auto / ProcessType=Interactive`
- Nature of this Goal: **production/source-of-truth cleanup only**
- TTS output-length boundary testing: **deferred to a separate future Goal**
- TTS memory/load/stress testing: **deferred to a separate future Goal**

This Goal exists to close the remaining maintenance and operational inconsistencies after the successful Post-Voice performance work. It must not reopen the completed TTS optimization experiment.

---

## 1. Mission

Ship a small Amadeus `1.6.2` stability release that does exactly four things:

1. repair stale repository instructions so Codex no longer treats the completed Post-Voice Goal as active;
2. retire the obsolete `goal/amadeus-1.5.3-voice-io` branch after proving it contains no unique runtime source that is absent from `main`;
3. align MLX source comments/errors/docs with its current production-selected status while preserving the explicit community-backend caveat and exact MPS rollback;
4. improve native TTS operational hygiene by preserving early launchd errors and verifying/hardening the port `18792` network boundary without breaking OrbStack/9Router access.

Do **not** optimize synthesis latency, change the accepted voice reference, or run a new load/stress experiment under this Goal.

---

## 2. Current verified baseline

Treat the following as the starting facts and verify them before editing:

- `main` is canonical and current product version is `1.6.1`.
- The previous Post-Voice engineering/TTS Goal is complete.
- OpenClaw remains the sole Agent runtime.
- The selected native TTS configuration is:
  - original protected A / ~46s `kurisu-v1` ICL reference;
  - community MLX 1.7B Base 8-bit backend;
  - `language=Auto`;
  - `ProcessType=Interactive`;
  - one inference worker + one bounded pending slot;
  - unchanged external 120s TTS window;
  - MPS retained only as an explicit protected rollback, never a parallel fallback.
- The current production choice is quality-approved. Do not rerun B/C/D/E voice-reference experiments.
- The old Voice branch is not canonical. At planning time, comparing `goal/amadeus-1.5.3-voice-io...main` reports `main` ahead by 137 and behind by 1; the branch-only head is `303ceb88...`, commit message `docs(goal): plan Amadeus 1.5.3 voice I/O`. Re-verify this before remote deletion because Git may change after this document is written.

Before implementation, run the normal repository startup:

```sh
cat docs/CONTEXT.md
cat docs/CURRENT_TASK.md
cat docs/AMADEUS_1_6_2_STABILITY_CLEANUP_GOAL.md
git status --short --branch
git log -5 --oneline --decorate
pnpm workflow:plan
```

Read `AGENTS.md` as repository rules, but where its top-level "current Goal" sentence conflicts with this document and `docs/CURRENT_TASK.md`, treat that stale sentence as the first bug to fix, not as authority to resume the old performance Goal.

---

## 3. Hard scope lock

### In scope for 1.6.2

- `AGENTS.md` / canonical startup/source-of-truth wording.
- `docs/CURRENT_TASK.md`, `docs/CONTEXT.md`, and minimal related current-state docs as needed to reflect this Goal/release.
- retirement of `goal/amadeus-1.5.3-voice-io` after evidence review.
- production terminology in MLX TTS source/config/docs.
- launchd early stderr/stdout capture with bounded growth.
- read-only reachability inspection and minimal safe hardening of TTS port `18792`.
- focused tests, release validation, version bump to `1.6.2`, release notes, explicit native TTS apply only if required, and real smoke/acceptance.

### Explicitly out of scope

Do not change or benchmark any of the following in this Goal:

- the ~46s A reference;
- reference transcript/profile contents;
- `language=Auto`;
- MLX 1.7B 8-bit model/revision;
- MLX vs MPS selection;
- `ProcessType=Interactive`;
- inference worker/pending-slot counts;
- queue start timeout;
- external 120s OpenClaw/WhatsApp TTS window;
- MP3 vs Opus product format;
- Voice Skill answer-length policy;
- `MAX_TEXT=1200` or any new production hard character ceiling;
- memory-pressure thresholds, automatic restart, model eviction, idle unload, cache clearing, MPS auto-fallback;
- load/concurrency/stress tests intended to determine TTS capacity.

The last two topics — **reasonable spoken-output hard limit** and **MLX/TTS pressure boundaries** — will be designed and executed as a separate measured Goal after 1.6.2 is closed.

---

## 4. Phase 0 — Baseline and task activation

1. Start from clean `main` and verify `VERSION=1.6.1`.
2. Create one short-lived work branch for this Goal, for example:

```sh
git switch main
git pull --ff-only
git switch -c work/amadeus-1.6.2-stability-cleanup
```

3. Record this Goal as the active task in `docs/CURRENT_TASK.md` without resurrecting historical performance work.
4. Do not bump `VERSION` yet.
5. Run `pnpm workflow:plan` and use the minimum sufficient verification level for each phase.

Acceptance:

- clean working tree before edits;
- current branch derives from latest canonical `main`;
- current task names this Goal;
- no TTS benchmark/stress process is started.

---

## 5. Phase 1 — Repair canonical Codex instructions

### Problem

`AGENTS.md` currently contains stale top-level wording that names the completed Post-Voice performance Goal as the current Goal, while `docs/CURRENT_TASK.md` and `docs/CONTEXT.md` say it is complete/no longer active. This can make a new Codex session resume old work incorrectly.

### Required change

Change the top-level current-task wording in `AGENTS.md` to a durable rule instead of naming a historical Goal.

Desired semantics:

```text
- docs/CURRENT_TASK.md is the canonical current-task pointer.
- Read an explicit Goal document only when CURRENT_TASK or the operator names it as active.
- Historical Goal documents and checkpoints are audit evidence, not live instructions.
```

Do not duplicate the whole current task inside `AGENTS.md`.

Audit `docs/CONTEXT.md` and `docs/CURRENT_TASK.md` for the same class of stale instruction. Keep current-state files short; historical details belong in reports/checkpoints/history.

Add/update a focused architecture/workflow test if one can cheaply detect a future regression where `AGENTS.md` hardcodes a completed Goal as current. Prefer a semantic/static assertion over a brittle full-text snapshot.

Acceptance:

- a fresh Codex session has one unambiguous source for the active task;
- Post-Voice performance Goal is clearly historical/completed;
- no instruction tells Codex to rerun cancelled B testing;
- startup context stays compact.

---

## 6. Phase 2 — Retire obsolete Voice branch safely

The branch `goal/amadeus-1.5.3-voice-io` is historical and should not remain as a tempting execution branch.

Before deletion, Codex must collect compact evidence:

```sh
git fetch origin --prune
git log --oneline main..origin/goal/amadeus-1.5.3-voice-io
git log --oneline origin/goal/amadeus-1.5.3-voice-io..main --max-count=20
git diff --stat main...origin/goal/amadeus-1.5.3-voice-io
```

Inspect the branch-only commit(s), especially `303ceb88...` if it is still the head. Confirm any useful Goal document/content already exists in canonical `main` and that no unique runtime implementation needs recovery.

If and only if this remains true, delete the remote historical branch:

```sh
git push origin --delete goal/amadeus-1.5.3-voice-io
```

Do not replace it with another permanent branch merely for audit. Git history, the canonical Goal document on `main`, and existing release/checkpoint history are sufficient unless Codex finds genuinely unique content.

If the branch has changed and now contains unique runtime source absent from `main`, stop deletion and document the discrepancy instead of force-deleting.

Acceptance:

- no obsolete Voice execution branch remains;
- `main` stays canonical;
- no unique implementation is lost;
- branch cleanup itself does not trigger product deployment.

---

## 7. Phase 3 — Promote MLX terminology from experiment to selected production backend

### Problem

The runtime/config/docs already declare MLX as the selected production engine, but parts of source still use experimental-era wording such as:

```text
Experimental community MLX backend
opt-in, never default
experimental_mlx_model_path_required
```

This is misleading to future maintainers/Codex.

### Required change

Align source terminology with reality:

- describe `QwenMlxEngine` as the **selected community MLX backend** or equivalent;
- preserve the important fact that `Blaizzy/mlx-audio` / converted MLX model is third-party community technology, not official Qwen upstream MLX;
- rename misleading internal error text such as `experimental_mlx_model_path_required` to a neutral production error such as `mlx_model_path_required`;
- update tests that assert the old error/category text;
- keep explicit fail-closed backend selection;
- keep MPS as manual rollback only;
- do not rename/move the existing protected `speech/mlx-poc/` runtime directory solely for aesthetics: it contains prepared large assets/venv and is already documented as a historical path name;
- do not rename scripts/paths if doing so creates compatibility churn without operational benefit. Comments/docs may state that historical `poc` naming is intentionally retained.

Acceptance:

- source comments, error categories and README no longer imply MLX is non-production;
- docs still disclose community dependency risk;
- no backend/model/profile/runtime behavior changes;
- engine selection tests remain fail-closed.

---

## 8. Phase 4 — Preserve launchd early-start errors with bounded logs

### Problem

The service has its own rotating application log after Python initializes, but the LaunchAgent currently discards stdout/stderr to `/dev/null`. Interpreter/import/venv failures that occur before the rotating logger starts can therefore disappear.

### Required behavior

Provide a small bounded early-start log under the existing Amadeus log directory, for example:

```text
~/Library/Logs/Amadeus/qwen3-tts-launchd.err.log
```

Implementation constraints:

- do not create unbounded logs;
- do not log request text, tokens, reference paths containing sensitive content, environment secrets or voice bytes;
- keep the existing sanitized rotating service log unchanged;
- the service manager may rotate/truncate the launchd bootstrap log before install/bootstrap when it exceeds a small cap (for example 1–2 MiB), or use an equally simple deterministic bounded mechanism;
- do not introduce a new daemon only to rotate one log;
- stdout may remain `/dev/null` if it contains no useful startup diagnostics; stderr is the important path.

Add tests/lint around the rendered plist and management script so the log path/cap behavior is reproducible.

Acceptance:

- a deliberately invalid *test fixture* can prove early-start stderr has a destination without breaking the live service;
- normal runtime still uses the existing rotating application log;
- secrets/content are not emitted;
- log growth is bounded.

Do not deliberately crash the production model process merely to test this.

---

## 9. Phase 5 — Verify and minimally harden TTS port 18792 network boundary

### Context

The native Mac service currently binds broadly because the OrbStack/9Router guest accesses it through:

```text
http://host.docker.internal:18792
```

Blindly changing the bind to `127.0.0.1` can break the production speech route. Do not hard-code a transient Docker/OrbStack bridge address.

### Step 1: read-only discovery

On M204, record sanitized evidence for:

```sh
lsof -nP -iTCP:18792 -sTCP:LISTEN
```

Verify from the OrbStack guest that:

- `/healthz` is reachable;
- authenticated speech route still works through the existing 9Router path.

Then determine whether port `18792` is reachable from an ordinary LAN peer/interface. Do not expose or print the TTS Bearer token while testing.

### Step 2: choose the smallest safe boundary

Preferred order:

1. if a stable macOS/OrbStack-supported bind or firewall rule can restrict the service to the required host/guest path **without depending on a transient bridge IP**, implement and source-control that rule/config;
2. otherwise keep `0.0.0.0` deliberately, document why it is required, and verify the security boundary:
   - synthesis and voice inventory remain Bearer-authenticated;
   - unauthenticated callers cannot synthesize audio;
   - `/healthz` reveals only low-sensitivity readiness/model/voice identifiers (or reduce it to a generic readiness response if that can be done without breaking probes);
   - secret remains 0600/outside Git;
   - no token appears in logs.

Do not deploy a brittle `pf` rule tied to one observed OrbStack subnet unless the rule can be generated/reconciled safely across bridge changes and reboot. Reliability is part of security here.

Acceptance:

- actual reachability is known and documented;
- OrbStack/9Router production path still works;
- no unauthenticated synthesis endpoint exists;
- any hardening is deterministic/reboot-safe and source-controlled;
- if broad bind remains, it is an explicit documented tradeoff rather than an accidental default.

---

## 10. Phase 6 — Focused verification

During ordinary edits, use targeted verification, not the entire release suite after every file change.

At minimum before release candidate:

```sh
pnpm workflow:plan
pnpm workflow:verify
python3 -m unittest discover -s apps/qwen3-tts-service/tests -v
bash -n infra/macos/manage-qwen3-tts.sh
plutil -lint infra/macos/com.amadeus.qwen3-tts.plist.example
pnpm check:architecture
git diff --check
pnpm check:secrets
```

Also run any focused test added for canonical Goal/task semantics and MLX error/category changes.

No TTS performance matrix, reference comparison, long-text capacity test, memory-pressure stress run or synthetic concurrency stress is required for 1.6.2.

---

## 11. Phase 7 — Candidate apply and real acceptance

Only runtime-affecting changes need apply.

If the LaunchAgent plist/management source changed:

1. preserve the existing protected native TTS rollback state;
2. apply through the existing `manage-qwen3-tts.sh` path;
3. verify the old inference process exits before the new one starts;
4. wait for `/healthz=ready` after real warmup;
5. verify the selected engine remains MLX;
6. perform one ordinary short authenticated TTS smoke;
7. perform one real WhatsApp voice-note turn and one ordinary typed turn.

Acceptance must verify:

- one Japanese PTT for voice input;
- visible text remains correct/nonduplicated;
- typed input remains text-only;
- accepted A/Kurisu timbre has no obvious regression;
- no new restart loop;
- launchd early error log exists/bounded as designed;
- 9Router route remains healthy.

Do not measure this as a new performance benchmark and do not reject the release merely because a single timing differs from the previous p50. This Goal is not a latency experiment.

No OpenClaw/CasaOS image rebuild should be performed unless the actual 1.6.2 diff requires OpenClaw runtime source/config to change. Documentation-only/source-comment changes do not justify a container rebuild.

---

## 12. Phase 8 — Release 1.6.2

After all source/runtime gates pass:

1. run the repository-required release checks;
2. bump only through:

```sh
scripts/amadeus-version.sh bump patch
```

Expected result from `1.6.1` is `1.6.2`.

3. replace `RELEASE_NOTES.md` with concise Chinese notes for this release only;
4. update `docs/CURRENT_TASK.md` to stable/no active Goal;
5. update `docs/CONTEXT.md` to `VERSION=1.6.2` and preserve only current facts;
6. create a dated checkpoint because this is a formal release/runtime operation;
7. commit/push clean canonical source;
8. fast-forward canonical `main` only after validation;
9. retire the short-lived `work/amadeus-1.6.2-stability-cleanup` branch after main is verified.

Suggested release-note scope:

```text
- 修正 Codex 当前任务/Goal source-of-truth，避免历史语音优化任务被误恢复。
- 收口 MLX 生产后端语义和旧 Voice 分支。
- 增强 Mac TTS LaunchAgent 启动错误可观测性，并确认 18792 网络访问边界。
```

Do not advertise new voice speed, new output-length limits or new memory-pressure guarantees in 1.6.2.

---

## 13. Definition of done

1. `main` is the only normal development/release source of truth.
2. `AGENTS.md` no longer hardcodes the completed Post-Voice Goal as current.
3. `CURRENT_TASK` / `CONTEXT` / Goal semantics are consistent.
4. obsolete `goal/amadeus-1.5.3-voice-io` is deleted only after proving no unique runtime source is lost.
5. MLX code/docs call the backend production-selected while still accurately labeling it community/third-party.
6. no automatic MLX→MPS fallback or dual-engine runtime is introduced.
7. launchd early startup failures have a bounded diagnostic destination.
8. port `18792` reachability/security boundary is measured, documented and minimally hardened without breaking OrbStack/9Router.
9. accepted A / MLX / Auto / Interactive voice configuration is unchanged.
10. no output-length hard cap or stress/memory threshold is introduced by this Goal.
11. real voice + typed smoke passes after any native runtime apply.
12. `VERSION=1.6.2`, release notes/current state are clean, and canonical `main` is pushed.

---

## 14. Explicit deferred follow-up Goal

After 1.6.2 is fully closed, create a separate measurement Goal for:

### A. Reasonable TTS output hard boundary

Measure fixed Japanese input lengths separately (candidate buckets should be chosen at that time, e.g. around 150 / 250 / 320 / 400 characters) with the accepted production A+MLX configuration. Determine a hard server-side ceiling from measured latency/reliability and product completeness, not from guesswork. Keep safety-critical replies complete.

### B. MLX/TTS pressure boundary

Measure sustained/repeated synthesis, queue contention, physical footprint, Metal allocation, swap **trend**, `memory_pressure`, error/recovery behavior and restart count. Define alert/rollback thresholds only after data exists. Do not use raw historical swap-used value alone as a restart trigger.

These experiments must be isolated from 1.6.2 so a cleanup release cannot accidentally change the accepted production voice or performance characteristics.
