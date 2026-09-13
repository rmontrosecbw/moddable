/*---
description: Linear model learns a separable two-class problem
flags: [module]
---*/

import {LinearModel} from "ml";

const model = new LinearModel({ labels: ["ok", "alert"] });
model.fit([
	{ x: [0, 0], y: 0 },
	{ x: [0.1, 0.2], y: 0 },
	{ x: [3, 3], y: 1 },
	{ x: [2.8, 3.2], y: 1 }
], { epochs: 120, learningRate: 0.2 });

assert.sameValue("ok", model.predict([0.05, 0.1]).label);
assert.sameValue("alert", model.predict([3.1, 2.9]).label);
