"use client";

import { useEffect, useState } from "react";
import type { ScenarioInputs } from "@/lib/housing";
import { PATHS, simulate, summarize, type Model, type Outcome, type Simulation, type Stress } from "@/lib/housing-model";

/** Futures drawn a few at a time, between frames. */
const CHUNK = 25;
/** How long the inputs must rest before futures are drawn for them. */
const SETTLE_MS = 300;

/** The comparison across the futures the model draws: worked out a moment
 *  after the inputs settle and a few futures at a time, so that typing stays
 *  quick, and begun again whenever they change. Until the new ones are drawn
 *  the last are kept, and `drawing` says they are out of date. */
export function useSimulation(inputs: ScenarioInputs, model: Model, stress: Stress): { simulation: Simulation | null; drawing: boolean } {
  const [done, setDone] = useState<{ inputs: ScenarioInputs; model: Model; stress: Stress; simulation: Simulation } | null>(null);

  useEffect(() => {
    if (model.history.length === 0) return;
    let stopped = false;
    const outcomes: Outcome[] = [];
    const step = () => {
      if (stopped) return;
      outcomes.push(...simulate(inputs, model, { first: outcomes.length, count: CHUNK, stress }));
      if (outcomes.length < PATHS) timer = window.setTimeout(step, 0);
      else setDone({ inputs, model, stress, simulation: summarize(outcomes) });
    };
    let timer = window.setTimeout(step, SETTLE_MS);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [inputs, model, stress]);

  if (model.history.length === 0) return { simulation: null, drawing: false };
  const current = done !== null && done.inputs === inputs && done.model === model && done.stress === stress;
  return { simulation: done?.simulation ?? null, drawing: !current };
}
