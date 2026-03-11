function conditionHash(condition: string): number {
  return Array.from(condition).reduce((sum, char, index) => sum + (index + 1) * char.charCodeAt(0), 0);
}

function makeSeededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sampleExplosionPoint(
  settings: Record<string, unknown>,
  condition: string,
  blockIdx: number,
  maxPumps: number
): number {
  const mode = String(settings.explosion_sampling_mode ?? "without_replacement_cycle");
  const stateKey = "__bart_explosion_state";
  const existingState = (settings[stateKey] as Record<string, { rng: () => number; bag: number[] }> | undefined) ?? {};
  settings[stateKey] = existingState;

  const blockSeeds = Array.isArray(settings.block_seed) ? settings.block_seed : [];
  const blockSeed = Number(blockSeeds[blockIdx] ?? settings.overall_seed ?? 2025);
  const samplerKey = `${blockIdx}:${condition}`;
  if (!existingState[samplerKey]) {
    existingState[samplerKey] = {
      rng: makeSeededRandom(blockSeed + conditionHash(condition)),
      bag: []
    };
  }

  const sampler = existingState[samplerKey];
  if (mode === "with_replacement") {
    return Math.floor(sampler.rng() * maxPumps) + 1;
  }
  if (mode === "without_replacement_cycle") {
    if (sampler.bag.length === 0) {
      sampler.bag = Array.from({ length: maxPumps }, (_, index) => index + 1);
      for (let index = sampler.bag.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(sampler.rng() * (index + 1));
        [sampler.bag[index], sampler.bag[swapIndex]] = [sampler.bag[swapIndex], sampler.bag[index]];
      }
    }
    return sampler.bag.pop() ?? 1;
  }
  throw new Error(`Unsupported explosion_sampling_mode='${mode}'.`);
}

export function summarizeBlock(rows: Array<Record<string, unknown>>, blockId: string): {
  total_score: number;
} {
  const blockRows = rows.filter((row) => row.block_id === blockId);
  return {
    total_score: blockRows.reduce((sum, row) => sum + Number(row.feedback_fb_score ?? 0), 0)
  };
}
