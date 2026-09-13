/*---
description: Policy engine maps sensor heuristics to controller actions
flags: [module]
---*/

import {HeuristicEngine, PolicyEngine} from "ml";

const engine = new HeuristicEngine;
engine.addChannel("temperature", { unit: "C" });
for (let i = 0; i < 6; i++)
	engine.observe({ temperature: 21 + i });

const policy = new PolicyEngine([
	{ id: "cool", when: { sensor: "temperature", op: ">", value: 24 }, then: { controller: "fan", value: 1 } }
]);
const actions = policy.evaluate(engine);
assert.sameValue(1, actions.length);
assert.sameValue("fan", actions[0].controller);
assert.sameValue(1, actions[0].value);
