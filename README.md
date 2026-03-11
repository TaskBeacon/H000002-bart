# H000002 BART

HTML/browser preview of the Balloon Analogue Risk Task built with `psyflow-web`.
The within-trial pump/cash loop, deterministic explosion sampler, risk-condition semantics, instruction text, and feedback logic are aligned to the local `T000002-bart` task; only the block and trial count are shortened for preview use.

## Layout

- `main.ts`: task-level orchestration
- `config/config.yaml`: declarative task config
- `src/run_trial.ts`: trial-level logic
- `src/utils.ts`: explosion sampler and block summary helpers
- `assets/`: task-specific balloon and audio assets

## Run

From [psyflow-web](/e:/xhmhc/TaskBeacon/psyflow-web):

```powershell
npm install
npm run dev
```

Then open:

```text
http://127.0.0.1:4173/?task=H000002-bart
```
