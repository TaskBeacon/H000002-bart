import {
  set_trial_context,
  type StimBank,
  type TaskSettings,
  type TrialBuilder,
  type TrialSnapshot
} from "psyflow-web";

import { sampleExplosionPoint } from "./utils";

function getTerminalOutcome(snapshot: TrialSnapshot): {
  fb_type: "pop" | "cash" | "timeout";
  fb_score: number;
  pump_count: number;
} | null {
  if (snapshot.units.pop?.fb_type) {
    return {
      fb_type: "pop",
      fb_score: Number(snapshot.units.pop?.fb_score ?? 0),
      pump_count: Number(snapshot.units.pop?.pump_count ?? 0)
    };
  }
  if (snapshot.units.cash?.fb_type) {
    return {
      fb_type: "cash",
      fb_score: Number(snapshot.units.cash?.fb_score ?? 0),
      pump_count: Number(snapshot.units.cash?.pump_count ?? 0)
    };
  }
  if (snapshot.units.timeout?.fb_type) {
    return {
      fb_type: "timeout",
      fb_score: Number(snapshot.units.timeout?.fb_score ?? 0),
      pump_count: Number(snapshot.units.timeout?.pump_count ?? 0)
    };
  }
  return null;
}

export function run_trial(
  trial: TrialBuilder,
  condition: string,
  context: {
    settings: TaskSettings;
    stimBank: StimBank;
    block_idx: number;
  }
): TrialBuilder {
  const { settings, stimBank, block_idx } = context;
  const pumpKey = String(settings.pump_key ?? "space");
  const cashKey = String(settings.cash_key ?? "right");
  const delta = Number(settings[`${condition}_delta`] ?? 0);
  const maxPumps = Number(settings[`${condition}_max_pumps`] ?? 1);
  const initialScale = Number(settings.initial_balloon_scale ?? 0.2);
  const maxScale = Number(settings.max_balloon_scale ?? 1);
  const balloonSize = (settings.balloon_size_deg as [number, number] | undefined) ?? [4, 5];
  const sizeStep = (maxScale - initialScale) / Math.max(1, maxPumps);
  const decisionTimeoutEnabled = Boolean(settings.decision_timeout_enabled ?? false);
  const decisionWindow = decisionTimeoutEnabled
    ? Number(settings.balloon_duration ?? 2)
    : null;
  const responseFeedbackDuration = Number(settings.response_feedback_duration ?? 1);
  const explosionPoint = sampleExplosionPoint(settings as Record<string, unknown>, condition, block_idx, maxPumps);

  trial.setTrialState("explosion_point", explosionPoint);
  trial.setTrialState("explosion_sampling_mode", String(settings.explosion_sampling_mode ?? "without_replacement_cycle"));
  trial.setTrialState("decision_timeout_enabled", decisionTimeoutEnabled);

  const fixation = trial.unit("fixation").addStim(stimBank.get("fixation"));
  set_trial_context(fixation, {
    trial_id: trial.trial_id,
    phase: "pre_pump_fixation",
    valid_keys: [pumpKey, cashKey],
    block_id: trial.block_id,
    condition_id: condition,
    task_factors: {
      condition,
      stage: "pre_pump_fixation",
      block_idx
    },
    stim_id: "fixation"
  });
  fixation.show({ duration: Number(settings.fixation_duration ?? 0.8) }).to_dict();

  const isPumpActive = (snapshot: TrialSnapshot, pumpIndex: number) => {
    if (pumpIndex === 0) {
      return true;
    }
    return snapshot.units[`pump_${pumpIndex - 1}`]?.response === pumpKey && pumpIndex < explosionPoint;
  };

  for (let pumpIndex = 0; pumpIndex < maxPumps; pumpIndex += 1) {
    const currentScale = initialScale + pumpIndex * sizeStep;
    const currentSize: [number, number] = [currentScale * balloonSize[0], currentScale * balloonSize[1]];
    const scoreBank = pumpIndex * delta;
    const pumpLabel = `pump_${pumpIndex}`;

    const pump = trial
      .unit(pumpLabel)
      .when((snapshot) => isPumpActive(snapshot, pumpIndex))
      .addStim(stimBank.rebuild(`${condition}_balloon`, { size: currentSize }))
      .addStim(stimBank.get_and_format("score_bank_text", { score_bank: scoreBank }));
    set_trial_context(pump, {
      trial_id: trial.trial_id,
      phase: "pump_decision",
      valid_keys: [pumpKey, cashKey],
      block_id: trial.block_id,
      condition_id: condition,
      task_factors: {
        condition,
        stage: "pump_decision",
        block_idx,
        pump_count: pumpIndex,
        score_bank: scoreBank
      },
      stim_id: `${condition}_balloon`
    });
    pump
      .captureResponse({
        keys: [pumpKey, cashKey],
        duration: decisionWindow,
        terminate_on_response: true
      })
      .set_state({
        pump_index: pumpIndex,
        score_bank_before: scoreBank
      })
      .to_dict();

    const pop = trial
      .unit("pop")
      .when((snapshot) => snapshot.units[pumpLabel]?.response === pumpKey && pumpIndex + 1 >= explosionPoint)
      .addStim(stimBank.rebuild(`${condition}_pop`, { size: currentSize }))
      .addStim(stimBank.get("pop_sound"));
    set_trial_context(pop, {
      trial_id: trial.trial_id,
      phase: "pop_outcome",
      valid_keys: [],
      block_id: trial.block_id,
      condition_id: condition,
      task_factors: {
        condition,
        stage: "pop_outcome",
        block_idx,
        pump_count: pumpIndex + 1,
        score_bank: scoreBank
      },
      stim_id: `${condition}_pop`
    });
    pop
      .show({ duration: responseFeedbackDuration })
      .set_state({
        fb_type: "pop",
        fb_score: 0,
        pump_count: pumpIndex + 1
      })
      .to_dict();

    const cash = trial
      .unit("cash")
      .when((snapshot) => snapshot.units[pumpLabel]?.response === cashKey)
      .addStim(stimBank.get("cash_screen"))
      .addStim(stimBank.get("cash_sound"));
    set_trial_context(cash, {
      trial_id: trial.trial_id,
      phase: "cash_outcome",
      valid_keys: [],
      block_id: trial.block_id,
      condition_id: condition,
      task_factors: {
        condition,
        stage: "cash_outcome",
        block_idx,
        pump_count: pumpIndex,
        score_bank: scoreBank
      },
      stim_id: "cash_screen"
    });
    cash
      .show({ duration: responseFeedbackDuration })
      .set_state({
        fb_type: "cash",
        fb_score: scoreBank,
        pump_count: pumpIndex
      })
      .to_dict();

    const timeout = trial
      .unit("timeout")
      .when((snapshot) => decisionTimeoutEnabled && !Boolean(snapshot.units[pumpLabel]?.key_press))
      .addStim(stimBank.get("timeout_screen"));
    set_trial_context(timeout, {
      trial_id: trial.trial_id,
      phase: "timeout_outcome",
      valid_keys: [],
      block_id: trial.block_id,
      condition_id: condition,
      task_factors: {
        condition,
        stage: "timeout_outcome",
        block_idx,
        pump_count: pumpIndex,
        score_bank: scoreBank
      },
      stim_id: "timeout_screen"
    });
    timeout
      .show({ duration: responseFeedbackDuration })
      .set_state({
        fb_type: "timeout",
        fb_score: 0,
        pump_count: pumpIndex
      })
      .to_dict();
  }

  trial
    .unit("feedback")
    .when((snapshot) => getTerminalOutcome(snapshot) !== null)
    .addStim((snapshot: TrialSnapshot) => {
      const outcome = getTerminalOutcome(snapshot);
      if (!outcome) {
        return null;
      }
      return stimBank.get_and_format(outcome.fb_type === "cash" ? "win_feedback" : "lose_feedback", {
        fb_score: outcome.fb_score
      });
    })
    .show({ duration: Number(settings.feedback_duration ?? 1) })
    .set_state({
      fb_type: (snapshot: TrialSnapshot) => getTerminalOutcome(snapshot)?.fb_type ?? null,
      fb_score: (snapshot: TrialSnapshot) => getTerminalOutcome(snapshot)?.fb_score ?? 0,
      pump_count: (snapshot: TrialSnapshot) => getTerminalOutcome(snapshot)?.pump_count ?? 0
    })
    .to_dict();

  return trial;
}
