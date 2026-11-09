# Nederlands · A2 → B2

Alex's personal Dutch course: 72 modules of 15–20 minutes, two a week (Monday + Thursday), from A2+ to B2 (Staatsexamen NT2 I and II).
Static site for GitHub Pages; progress syncs with the same personal-code system as the Studiehub (stored in its own row, `<code>-nl`).

Each module: warm-up (your due mistakes + words) · new words · reading · listening + dictation · grammar · writing · speaking (shadowing).
Between modules: the daily review (spaced repetition of words + an error bank that keeps mistakes until you get them right twice).

- `curriculum.js`: the full course outline (phases, grammar sequence, writing tasks)
- `content/mNN.json`: module source (edit this) → `tools/build.py` → `modules/mNN.js` + `audio/mNN/*.m4a` (macOS voices Xander/Ellen)
- `assets/app.js`: the app · `assets/sync.js`: sync (Supabase RPC `get_progress`/`save_progress`, same project as the Studiehub)
- `tools/progress.py`: learner report from the synced data (needs `tools/.sync-code`, git-ignored)
- `tools/test_site.py`: full click-test of a module on phone + desktop (Playwright, venv `~/.venvs/studie`)
- New modules: the `nederlands-module` skill (Dropbox `claude projects/skills/nederlands-module`)
