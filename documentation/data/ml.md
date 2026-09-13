# On-device ML
Copyright 2026 Moddable Tech, Inc.  
Revised: September 13, 2026

## Table of Contents

* [Introduction](#intro)
* [HeuristicEngine](#engine)
* [OnlineStats](#stats)
* [EWMA](#ewma)
* [RingBuffer](#ring)
* [AnomalyDetector](#anomaly)
* [LinearModel](#linear)
* [PolicyEngine](#policy)

<a id="intro"></a>
## Introduction

The `ml` module is a small on-device machine-learning and heuristics library for microcontroller IoT applications. It is intended for ESP32-S3 class devices that collect sensor data and must decide how to drive controllers without sending every sample to the cloud.

It does **not** embed TensorFlow Lite. That stack is C++, large, and incompatible with the Moddable SDK's C-only native layer. The useful work for sensor/controller nodes is:

- keep a bounded history
- estimate mean, variance, and trend
- flag anomalies
- apply if-then operating policies
- optionally score a tiny logistic linear model

```js
import {HeuristicEngine, PolicyEngine, LinearModel} from "ml";
```

Include the module's manifest:

```json
"include": [
	"$(MODULES)/data/ml/manifest.json"
]
```

See the [MCP IoT example](../../examples/network/mcp-iot/readme.md) for a complete ESP32-S3 application that combines this engine with an MCP server.

<a id="engine"></a>
## class HeuristicEngine

`HeuristicEngine` owns named sensor channels. Each call to `observe(sample)` updates statistics and returns readings, an anomaly count, a health string, and an optional model prediction.

```js
const engine = new HeuristicEngine;
engine.addChannel("temperature", { unit: "C", window: 32, zLimit: 3 });
const result = engine.observe({ temperature: 22.5 });
```

`trainBaseline()` freezes the current per-channel statistics as the normal operating envelope.

<a id="stats"></a>
## class OnlineStats

Welford's algorithm for a numerically stable running mean and sample variance. `zscore(value)` is `(value - mean) / stddev`.

<a id="ewma"></a>
## class EWMA

Exponentially weighted moving average. `alpha` is in `(0, 1]`.

<a id="ring"></a>
## class RingBuffer

Fixed-capacity sample window. `slope()` is the least-squares trend across the window. Memory use is bounded by `capacity`, which matters on ESP32-S3.

<a id="anomaly"></a>
## class AnomalyDetector

Marks a sample as an anomaly when `|zscore| >= zLimit` and at least `minSamples` have been seen. `trainBaseline()` snapshots the current stats.

<a id="linear"></a>
## class LinearModel

A logistic linear classifier: `score = sigmoid(w · x + b)`. `fit(samples)` runs a small number of SGD epochs. This is native inference in the sense that it runs on the MCU; it is not a hosted GPU model.

```js
const model = new LinearModel({ labels: ["nominal", "intervene"] });
model.fit([
	{ x: [21, 0.1, 0], y: 0 },
	{ x: [31, 3.2, 0.4], y: 1 }
]);
model.predict([30, 3.0, 0.3]);
```

<a id="policy"></a>
## class PolicyEngine

Maps channel metrics onto controller actions.

```js
const policy = new PolicyEngine([
	{
		id: "cool-if-hot",
		when: { sensor: "temperature", op: ">", value: 27 },
		then: { controller: "fan", value: 1 }
	}
]);
const actions = policy.evaluate(engine);
```

`when.metric` may be `value`, `smoothed`, `slope`, `zscore`, `mean`, or `anomaly`. Multiple clauses are AND-ed.
