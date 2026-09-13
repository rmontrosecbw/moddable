/*---
description: Anomaly detector flags z-score outliers
flags: [module]
---*/

import {AnomalyDetector} from "ml";

const detector = new AnomalyDetector({ zLimit: 3, minSamples: 5 });
for (let i = 0; i < 10; i++)
	detector.update(20 + (i % 2) * 0.2);

const normal = detector.score(20.1);
assert.sameValue(false, normal.anomaly, "in-range sample");

const hot = detector.score(80);
assert.sameValue(true, hot.anomaly, "large z-score");
assert.sameValue(true, hot.zscore > 3, "z-score magnitude");
