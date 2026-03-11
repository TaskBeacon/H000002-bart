import {
  BlockUnit,
  StimBank,
  SubInfo,
  TaskSettings,
  TrialBuilder,
  count_down,
  mountTaskApp,
  next_trial_id,
  parsePsyflowConfig,
  reset_trial_counter,
  type CompiledTrial,
  type Resolvable,
  type RuntimeView,
  type StimRef,
  type StimSpec,
  type TrialSnapshot
} from "psyflow-web";

import configText from "./config/config.yaml?raw";
import { run_trial } from "./src/run_trial";
import { summarizeBlock } from "./src/utils";

const blueBalloonAsset = new URL("./assets/blue_balloon.png", import.meta.url).href;
const yellowBalloonAsset = new URL("./assets/yellow_balloon.png", import.meta.url).href;
const orangeBalloonAsset = new URL("./assets/orange_balloon.png", import.meta.url).href;
const bluePopAsset = new URL("./assets/blue_pop.png", import.meta.url).href;
const yellowPopAsset = new URL("./assets/yellow_pop.png", import.meta.url).href;
const orangePopAsset = new URL("./assets/orange_pop.png", import.meta.url).href;
const popSoundAsset = new URL("./assets/pop.ogg", import.meta.url).href;
const cashSoundAsset = new URL("./assets/cash_fixed.ogg", import.meta.url).href;
const instructionVoiceAsset = new URL("./assets/instruction_text_voice.mp3", import.meta.url).href;

function patchBARTAssets(stimConfig: Record<string, StimSpec>): void {
  const imageOverrides: Record<string, string> = {
    blue_balloon: blueBalloonAsset,
    yellow_balloon: yellowBalloonAsset,
    orange_balloon: orangeBalloonAsset,
    blue_pop: bluePopAsset,
    yellow_pop: yellowPopAsset,
    orange_pop: orangePopAsset
  };
  const soundOverrides: Record<string, string> = {
    pop_sound: popSoundAsset,
    cash_sound: cashSoundAsset
  };

  for (const [label, assetUrl] of Object.entries(imageOverrides)) {
    const spec = stimConfig[label];
    if (spec?.type === "image") {
      stimConfig[label] = {
        ...spec,
        image: assetUrl
      };
    }
  }

  for (const [label, assetUrl] of Object.entries(soundOverrides)) {
    const spec = stimConfig[label];
    if (spec?.type === "sound") {
      stimConfig[label] = {
        ...spec,
        file: assetUrl
      };
    }
  }
}

function buildWaitTrial(
  meta: { trial_id: string; condition: string; trial_index: number },
  blockId: string | null,
  unitLabel: string,
  stimInputs: Array<Resolvable<StimRef | StimSpec | null>>
): CompiledTrial {
  const trial = new TrialBuilder({
    trial_id: meta.trial_id,
    block_id: blockId,
    trial_index: meta.trial_index,
    condition: meta.condition
  });
  trial.unit(unitLabel).addStim(...stimInputs).waitAndContinue();
  return trial.build();
}

export async function run(root: HTMLElement): Promise<void> {
  const parsed = parsePsyflowConfig(configText, import.meta.url);
  patchBARTAssets(parsed.stim_config);
  const settings = TaskSettings.from_dict(parsed.task_config);
  const subInfo = new SubInfo(parsed.subform_config);
  const stimBank = new StimBank(parsed.stim_config);

  settings.triggers = parsed.trigger_config;

  if (settings.voice_enabled) {
    stimBank.convert_to_voice("instruction_text", {
      voice: String(settings.voice_name ?? "zh-CN-YunyangNeural"),
      rate: 1,
      assetFiles: {
        instruction_text: instructionVoiceAsset
      },
      fallbackToSpeech: false
    });
  }

  await mountTaskApp({
    root,
    task_id: "H000002-bart",
    task_name: "Balloon Analogue Risk Task (BART)",
    task_description: "HTML preview aligned to the local psyflow BART procedure and parameters.",
    settings,
    subInfo,
    stimBank,
    buildTrials: (): CompiledTrial[] => {
      reset_trial_counter();

      const compiledTrials: CompiledTrial[] = [];
      const instructionInputs: Array<Resolvable<StimRef | StimSpec | null>> = [stimBank.get("instruction_text")];
      if (settings.voice_enabled) {
        instructionInputs.push(stimBank.get("instruction_text_voice"));
      }
      compiledTrials.push(
        buildWaitTrial(
          { trial_id: "instruction", condition: "instruction", trial_index: -1 },
          null,
          "instruction_text",
          instructionInputs
        )
      );

      for (let blockIndex = 0; blockIndex < Number(settings.total_blocks ?? 1); blockIndex += 1) {
        const blockId = `block_${blockIndex}`;
        compiledTrials.push(
          ...count_down({
            seconds: 3,
            block_id: blockId,
            trial_id_prefix: `countdown_${blockId}`,
            stim: {
              color: "white",
              height: 3.5
            }
          })
        );

        const block = new BlockUnit({
          block_id: blockId,
          block_idx: blockIndex,
          settings
        }).generate_conditions();

        block.conditions.forEach((condition, trialIndex) => {
          const trial = new TrialBuilder({
            trial_id: next_trial_id(),
            block_id: block.block_id,
            trial_index: trialIndex,
            condition
          });
          run_trial(trial, condition, {
            settings,
            stimBank,
            block_idx: blockIndex
          });
          compiledTrials.push(trial.build());
        });

        compiledTrials.push(
          buildWaitTrial(
            {
              trial_id: `block_break_${blockIndex}`,
              condition: "block_break",
              trial_index: Number(block.conditions.length) + blockIndex
            },
            block.block_id,
            "block",
            [
              (_snapshot: TrialSnapshot, runtime: RuntimeView) => {
                const summary = summarizeBlock(runtime.getReducedRows(), block.block_id);
                return stimBank.get_and_format("block_break", {
                  block_num: blockIndex + 1,
                  total_blocks: settings.total_blocks,
                  total_score: summary.total_score
                });
              }
            ]
          )
        );
      }

      compiledTrials.push(
        buildWaitTrial(
          {
            trial_id: "goodbye",
            condition: "goodbye",
            trial_index: Number(settings.total_trials ?? 0)
          },
          null,
          "goodbye",
          [
            (_snapshot: TrialSnapshot, runtime: RuntimeView) =>
              stimBank.get_and_format("good_bye", {
                total_score: runtime.sumReducedField("feedback_fb_score")
              })
          ]
        )
      );

      return compiledTrials;
    }
  });
}

export async function main(root: HTMLElement): Promise<void> {
  await run(root);
}

export default main;
