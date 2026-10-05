"use client";

import { useEffect, useMemo, useState } from "react";
import type { ScenarioInputs } from "@/lib/housing";
import { PATHS, simulate, summarize, type Model, type Outcome, type Simulation, type Stress } from "@/lib/housing-model";

/** Futures drawn a few at a time, between frames. */
const CHUNK = 25;
/** How long the inputs must rest before futures are drawn for them. */
const SETTLE_MS = 300;
/** Comparisons whose futures are kept, the latest. */
const KEEP = 32;

/** Futures already drawn, by the model they were drawn from and by what was
 *  asked of it -- the inputs and the stress -- so that going back to a
 *  comparison, or to a stress tried before, shows them at once rather than
 *  drawing them again. The draws are seeded: kept or drawn anew, they are the
 *  same futures. */
const drawn = new WeakMap<Model, Map<string, Simulation>>();

function remember(model: Model, key: string, simulation: Simulation) {
  let kept = drawn.get(model);
  if (!kept) drawn.set(model, (kept = new Map()));
  kept.delete(key);
  kept.set(key, simulation);
  if (kept.size > KEEP) kept.delete(kept.keys().next().value!);
}

/** The comparison across the futures the model draws: worked out a moment
 *  after the inputs settle and a few futures at a time, so that typing stays
 *  quick, and begun again whenever they change -- unless they were drawn for
 *  these inputs before. Until the new ones are drawn the last are kept, and
 *  `drawing` says they are out of date. */
export function useSimulation(inputs: ScenarioInputs, model: Model, stress: Stress, enabled = true): { simulation: Simulation | null; drawing: boolean } {
  const key = useMemo(() => JSON.stringify([inputs, stress]), [inputs, stress]);
  const [done, setDone] = useState<{ model: Model; key: string; simulation: Simulation } | null>(null);
  const kept = drawn.get(model)?.get(key);

  useEffect(() => {
    if (!enabled || model.history.length === 0 || drawn.get(model)?.has(key)) return;
    let stopped = false;
    const outcomes: Outcome[] = [];
    const step = () => {
      if (stopped) return;
      outcomes.push(...simulate(inputs, model, { first: outcomes.length, count: Math.max(1, Math.floor(CHUNK * Math.min(1, 15 / inputs.years))), stress }));
      if (outcomes.length < PATHS) {
        timer = window.setTimeout(step, 0);
        return;
      }
      const simulation = summarize(outcomes);
      remember(model, key, simulation);
      setDone({ model, key, simulation });
    };
    let timer = window.setTimeout(step, SETTLE_MS);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [inputs, model, stress, key, enabled]);

  if (!enabled || model.history.length === 0) return { simulation: null, drawing: false };
  if (kept) return { simulation: kept, drawing: false };
  return { simulation: done?.simulation ?? null, drawing: true };
}
