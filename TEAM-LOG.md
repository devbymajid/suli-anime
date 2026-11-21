# Suli Anime — Team Log (سجل الفريق)

Shared coordination log for the two Muses building Suli Anime together:
Abdelmajid's Muse and his friend's Muse.

## Rules — both Muses must follow these

1. **Read this log BEFORE starting any work.**
2. **Claim your task first:** mark it `IN PROGRESS` below with your name
   before you start. Never start work the other Muse has marked in progress.
3. **After finishing a step, append a dated entry** to the log: what changed,
   which files, version number, review result, live-verification result.
4. **One thing at a time.** Owner's pipeline, always:
   build → independent review (must say «مزيان») → publish → live verification.
5. **The repo is the source of truth.** If this log and the repo disagree,
   the repo wins — and the Muse that spots it fixes the log.
6. Keep entries short (one or two lines each). No secrets, no passwords,
   no tokens in this file, ever.

## Who is who

- **Muse Abdelmajid** — owner's Muse, big manager of the project.
- **Muse Friend** — friend's Muse, co-builder.
  (GitHub access: logs in with the owner's account, devbymajid —
  owner's explicit decision 2026-11-21; no separate collaborator invite.)

## Now — current state (2026-11-21 ~18:20 CET)

- **⚠️ PIVOT (user's explicit decision, 2026-11-21 ~18:20): Suli Anime
  is FROZEN as an archive. NO new work on this repo. The user replaced
  it with a fitness battle game (new project, new repo — separate
  work, not here). Do NOT start new Suli Anime work.**
- **Live version (FINAL):** v1.9.0 — map D «شارع التسوق» + tap-to-walk
  fix. The game stays live at https://devbymajid.github.io/suli-anime/
  as an archive; nothing is deleted.
- **Maps:** A «الساحة المركزية» LIVE (v1.5.0) · B «قرية النهر» LIVE (v1.5.1)
  · C «سفح التل» LIVE (v1.8.0) · D «شارع التسوق» LIVE (v1.9.0).
  All four maps shipped.
- **Known open item:** none — the old ≲300 draw-call target is
  discredited as frustum-dependent; D's absolute load was judged
  shippable by builder and reviewer.

## In progress

- 2026-11-21 ~18:20 — Muse Abdelmajid: v1.9.0 live verification
  closing out (final result to be recorded, then closed — no new
  Suli Anime work after that).

## Log (newest first)

- 2026-11-21 ~18:20 — Muse Abdelmajid: **PIVOT — Suli Anime FROZEN
  by the user's explicit decision.** Replaced by a fitness battle game
  (1v1 ranked push-up battles, camera AI rep counting). This repo is
  preserved as-is (code + live site, nothing deleted); the new game
  gets its own repo. No new work here. v1.9.0 live test closing out.
- 2026-11-21 ~17:15 — Muse Abdelmajid: v1.9.0 DEPLOYED (commit
  d80a462, PR #4): map D + tap fix live, curl-verified. Independent
  review «مزيان» (200 checks, 0 product defects). Live test running.
- 2026-11-21 ~16:10 — Muse Abdelmajid: map D rebase built (134 checks,
  0 errors; perf judged shippable). Builder found a REAL tap bug
  (camera inside a shop hit cylinder → tap opens the shop instead of
  walking, all maps, since v1.5) — parent fix applied in pickShop,
  rides with v1.9.0. In independent review now.
- 2026-11-21 ~14:44 — Muse Abdelmajid: v1.8.0 live-verified 187/194,
  0 product defects (7 fails proven harness defects). Map C + bubble
  fix confirmed live (bubble ~95–100px from player's head, was ~35px).
- 2026-11-21 ~14:40 — Muse Abdelmajid: team log published to repo root
  (TEAM-LOG.md, first upload — shared log for both Muses).
- 2026-11-21 ~14:39 — Muse Abdelmajid: team log created (owner's order:
  one shared note so each Muse knows what the other did).
- 2026-11-21 ~14:14 — Muse Abdelmajid: v1.8.0 LIVE (commit d369b09,
  2 files) — map C + greeting-bubble fix. Review «مزيان» (~177 checks).
  Live verification in progress.
- 2026-11-21 ~12:14 — Muse Abdelmajid: v1.7.0 live-verified 147/151,
  0 errors (3 fails proven harness defects).
- 2026-11-21 ~11:52 — Muse Abdelmajid: v1.7.0 LIVE (commit e38f7b7,
  7 files) — account deletion + live NPCs + designer fix + pill fix.
  Review «مزيان» 105 checks + re-review 50/50.
- 2026-11-21 ~11:05 — Muse Abdelmajid: v1.6.0 LIVE (commit 78d8ec3,
  5 files) — signup + character creation, 18+ age gate.
  Review «مزيان» 67/67.
- 2026-11-21 ~09:43 — Muse Abdelmajid: map B (v1.5.1) LIVE
  (commit 731ae41) — River Village + map-picker fix. Review «مزيان» 116.
- 2026-11-21 ~08:38 — Muse Abdelmajid: map A (v1.5.0) LIVE
  (commits 6df7552 / ffc8ae9 / 3245b79) — Central Market Square + shops
  + map picker. Review «مزيان» 158/159.
- 2026-11-20 ~21:12 — Muse Abdelmajid: v1.4.2 LIVE — floating name
  labels removed. Live-verified 83/83.
- 2026-11-20 ~20:09 — Muse Abdelmajid: v1.4.1 LIVE — camera drag,
  closer camera, higher quality + quality setting. Live-verified 75/75.
- 2026-11-20 ~18:47 — Muse Abdelmajid: v1.4 LIVE (commit 09e1b96) —
  detailed village. Live-verified 59/59.
