function conditionHash(condition: string): number {
  return Array.from(condition).reduce((sum, char, index) => sum + (index + 1) * char.charCodeAt(0), 0);
}

class PythonRandom {
  private mt = new Array<number>(624).fill(0);
  private index = 624;

  constructor(seed: number) {
    this.seed(seed);
  }

  private seed(seed: number): void {
    this.mt[0] = 19650218;
    for (let index = 1; index < 624; index += 1) {
      const previous = this.mt[index - 1] ^ (this.mt[index - 1] >>> 30);
      this.mt[index] = (Math.imul(1812433253, previous) + index) >>> 0;
    }

    const key = [Math.abs(Math.trunc(seed)) >>> 0];
    let i = 1;
    let j = 0;
    for (let k = Math.max(624, key.length); k > 0; k -= 1) {
      const previous = this.mt[i - 1] ^ (this.mt[i - 1] >>> 30);
      this.mt[i] = ((this.mt[i] ^ Math.imul(previous, 1664525)) + key[j] + j) >>> 0;
      i += 1;
      j += 1;
      if (i >= 624) {
        this.mt[0] = this.mt[623];
        i = 1;
      }
      if (j >= key.length) {
        j = 0;
      }
    }
    for (let k = 623; k > 0; k -= 1) {
      const previous = this.mt[i - 1] ^ (this.mt[i - 1] >>> 30);
      this.mt[i] = ((this.mt[i] ^ Math.imul(previous, 1566083941)) - i) >>> 0;
      i += 1;
      if (i >= 624) {
        this.mt[0] = this.mt[623];
        i = 1;
      }
    }
    this.mt[0] = 0x80000000;
    this.index = 624;
  }

  private nextUint32(): number {
    if (this.index >= 624) {
      this.twist();
    }
    let value = this.mt[this.index];
    this.index += 1;
    value ^= value >>> 11;
    value ^= (value << 7) & 0x9d2c5680;
    value ^= (value << 15) & 0xefc60000;
    value ^= value >>> 18;
    return value >>> 0;
  }

  private twist(): void {
    for (let index = 0; index < 624; index += 1) {
      const y = (this.mt[index] & 0x80000000) + (this.mt[(index + 1) % 624] & 0x7fffffff);
      let value = this.mt[(index + 397) % 624] ^ (y >>> 1);
      if (y % 2 !== 0) {
        value ^= 0x9908b0df;
      }
      this.mt[index] = value >>> 0;
    }
    this.index = 0;
  }

  randBelow(maxExclusive: number): number {
    const max = Math.max(1, Math.floor(maxExclusive));
    const bitLength = max.toString(2).length;
    let value = this.nextUint32() >>> (32 - bitLength);
    while (value >= max) {
      value = this.nextUint32() >>> (32 - bitLength);
    }
    return value;
  }
}

export function sampleExplosionPoint(
  settings: Record<string, unknown>,
  condition: string,
  blockIdx: number,
  maxPumps: number
): number {
  const mode = String(settings.explosion_sampling_mode ?? "without_replacement_cycle");
  const stateKey = "__bart_explosion_state";
  const existingState = (settings[stateKey] as Record<string, { rng: PythonRandom; bag: number[] }> | undefined) ?? {};
  settings[stateKey] = existingState;

  const blockSeeds = Array.isArray(settings.block_seed) ? settings.block_seed : [];
  const blockSeed = Number(blockSeeds[blockIdx] ?? settings.overall_seed ?? 2025);
  const samplerKey = `${blockIdx}:${condition}`;
  if (!existingState[samplerKey]) {
    existingState[samplerKey] = {
      rng: new PythonRandom(blockSeed + conditionHash(condition)),
      bag: []
    };
  }

  const sampler = existingState[samplerKey];
  if (mode === "with_replacement") {
    return sampler.rng.randBelow(maxPumps) + 1;
  }
  if (mode === "without_replacement_cycle") {
    if (sampler.bag.length === 0) {
      sampler.bag = Array.from({ length: maxPumps }, (_, index) => index + 1);
      for (let index = sampler.bag.length - 1; index > 0; index -= 1) {
        const swapIndex = sampler.rng.randBelow(index + 1);
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
