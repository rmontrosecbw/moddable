/*---
description: OnlineStats Welford mean and sample variance
flags: [module]
---*/

import {OnlineStats} from "ml";

const stats = new OnlineStats;
stats.update(2);
stats.update(4);
stats.update(4);
stats.update(4);
stats.update(5);
stats.update(5);
stats.update(7);
stats.update(9);

assert.sameValue(8, stats.count);
assert.sameValue(5, stats.mean);
assert.sameValue(true, Math.abs(stats.variance - (32 / 7)) < 1e-10, "sample variance");
assert.sameValue(true, Math.abs(stats.stddev - Math.sqrt(32 / 7)) < 1e-10, "sample stddev");
assert.sameValue(true, stats.zscore(2) < -1, "low z-score");
