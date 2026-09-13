/*
 * Copyright (c) 2026  Moddable Tech, Inc.
 *
 *   This file is part of the Moddable SDK Runtime.
 *
 *   The Moddable SDK Runtime is free software: you can redistribute it and/or modify
 *   it under the terms of the GNU Lesser General Public License as published by
 *   the Free Software Foundation, either version 3 of the License, or
 *   (at your option) any later version.
 *
 *   The Moddable SDK Runtime is distributed in the hope that it will be useful,
 *   but WITHOUT ANY WARRANTY; without even the implied warranty of
 *   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *   GNU Lesser General Public License for more details.
 *
 *   You should have received a copy of the GNU Lesser General Public License
 *   along with the Moddable SDK Runtime.  If not, see <http://www.gnu.org/licenses/>.
 *
 */

/*
	On-device ML and heuristics for microcontroller IoT workloads.

	Designed for ESP32-class devices: fixed memory, no cloud dependency,
	and enough math to decide controller actions from live sensor data.
*/

const DEFAULT_WINDOW = 32;
const DEFAULT_ZSCORE = 3;

function isFiniteNumber(value) {
	return "number" === typeof value && Number.isFinite(value);
}

function round4(value) {
	return Math.round(value * 10000) / 10000;
}

function compare(op, left, right) {
	switch (op) {
		case ">": return left > right;
		case ">=": return left >= right;
		case "<": return left < right;
		case "<=": return left <= right;
		case "==":
		case "=": return left === right;
		case "!=": return left !== right;
		default: throw new Error(`unsupported op ${op}`);
	}
}

class OnlineStats {
	constructor() {
		this.reset();
	}
	reset() {
		this.count = 0;
		this.mean = 0;
		this.m2 = 0;
		this.min = undefined;
		this.max = undefined;
	}
	update(value) {
		if (!isFiniteNumber(value))
			throw new TypeError("value must be a finite number");
		this.count += 1;
		const delta = value - this.mean;
		this.mean += delta / this.count;
		this.m2 += delta * (value - this.mean);
		if (undefined === this.min || value < this.min)
			this.min = value;
		if (undefined === this.max || value > this.max)
			this.max = value;
		return this;
	}
	get variance() {
		return this.count > 1 ? this.m2 / (this.count - 1) : 0;
	}
	get stddev() {
		return Math.sqrt(this.variance);
	}
	zscore(value) {
		const stddev = this.stddev;
		if (stddev <= 0)
			return 0;
		return (value - this.mean) / stddev;
	}
	snapshot() {
		return {
			count: this.count,
			mean: round4(this.mean),
			stddev: round4(this.stddev),
			min: this.min,
			max: this.max
		};
	}
}

class EWMA {
	constructor(alpha = 0.2) {
		if (!isFiniteNumber(alpha) || alpha <= 0 || alpha > 1)
			throw new RangeError("alpha must be in (0, 1]");
		this.alpha = alpha;
		this.value = undefined;
	}
	update(sample) {
		if (!isFiniteNumber(sample))
			throw new TypeError("sample must be a finite number");
		this.value = undefined === this.value ? sample : (this.alpha * sample) + ((1 - this.alpha) * this.value);
		return this.value;
	}
}

class RingBuffer {
	constructor(capacity = DEFAULT_WINDOW) {
		if (!Number.isInteger(capacity) || capacity < 2)
			throw new RangeError("capacity must be an integer >= 2");
		this.capacity = capacity;
		this.values = new Float64Array(capacity);
		this.length = 0;
		this.next = 0;
	}
	push(value) {
		if (!isFiniteNumber(value))
			throw new TypeError("value must be a finite number");
		this.values[this.next] = value;
		this.next = (this.next + 1) % this.capacity;
		if (this.length < this.capacity)
			this.length += 1;
		return this.length;
	}
	at(index) {
		if (index < 0 || index >= this.length)
			return undefined;
		const start = this.length === this.capacity ? this.next : 0;
		return this.values[(start + index) % this.capacity];
	}
	toArray() {
		const result = new Array(this.length);
		for (let i = 0; i < this.length; i++)
			result[i] = this.at(i);
		return result;
	}
	slope() {
		const n = this.length;
		if (n < 2)
			return 0;
		let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
		for (let i = 0; i < n; i++) {
			const y = this.at(i);
			sumX += i;
			sumY += y;
			sumXY += i * y;
			sumXX += i * i;
		}
		const denom = (n * sumXX) - (sumX * sumX);
		if (0 === denom)
			return 0;
		return ((n * sumXY) - (sumX * sumY)) / denom;
	}
	latest() {
		return this.length ? this.at(this.length - 1) : undefined;
	}
}

class AnomalyDetector {
	constructor(options = {}) {
		this.zLimit = options.zLimit ?? DEFAULT_ZSCORE;
		this.minSamples = options.minSamples ?? 8;
		this.stats = new OnlineStats;
		this.baseline = undefined;
	}
	update(value) {
		this.stats.update(value);
		return this.score(value);
	}
	trainBaseline() {
		if (this.stats.count < 2)
			throw new Error("not enough samples to train a baseline");
		this.baseline = this.stats.snapshot();
		this.baseline.zLimit = this.zLimit;
		return this.baseline;
	}
	score(value) {
		const ready = this.stats.count >= this.minSamples;
		const z = ready ? this.stats.zscore(value) : 0;
		return {
			value,
			zscore: round4(z),
			anomaly: ready && Math.abs(z) >= this.zLimit,
			ready
		};
	}
}

class LinearModel {
	constructor(options = {}) {
		this.weights = options.weights ? options.weights.slice() : [];
		this.bias = options.bias ?? 0;
		this.labels = options.labels ?? ["normal", "alert"];
		this.threshold = options.threshold ?? 0.5;
	}
	#dot(features) {
		if (features.length !== this.weights.length)
			throw new RangeError("feature length does not match model weights");
		let sum = this.bias;
		for (let i = 0; i < features.length; i++)
			sum += this.weights[i] * features[i];
		return sum;
	}
	predict(features) {
		if (!Array.isArray(features) || !features.every(isFiniteNumber))
			throw new TypeError("features must be an array of finite numbers");
		if (!this.weights.length)
			throw new Error("model has no weights");
		const logit = this.#dot(features);
		const score = 1 / (1 + Math.exp(-logit));
		const label = score >= this.threshold ? this.labels[1] : this.labels[0];
		return {
			score: round4(score),
			logit: round4(logit),
			label
		};
	}
	fit(samples, options = {}) {
		if (!Array.isArray(samples) || samples.length < 2)
			throw new RangeError("fit requires at least two {x, y} samples");
		const learningRate = options.learningRate ?? 0.05;
		const epochs = options.epochs ?? 80;
		const width = samples[0].x.length;
		this.weights = new Array(width).fill(0);
		this.bias = 0;
		for (let epoch = 0; epoch < epochs; epoch++) {
			for (let i = 0; i < samples.length; i++) {
				const features = samples[i].x;
				if (features.length !== width)
					throw new RangeError("inconsistent feature width");
				const predicted = 1 / (1 + Math.exp(-this.#dot(features)));
				const error = predicted - samples[i].y;
				for (let j = 0; j < width; j++)
					this.weights[j] -= learningRate * error * features[j];
				this.bias -= learningRate * error;
			}
		}
		return this.export();
	}
	export() {
		return {
			weights: this.weights.map(round4),
			bias: round4(this.bias),
			labels: this.labels.slice(),
			threshold: this.threshold
		};
	}
}

class Channel {
	constructor(name, options = {}) {
		this.name = name;
		this.unit = options.unit;
		this.window = new RingBuffer(options.window ?? DEFAULT_WINDOW);
		this.stats = new OnlineStats;
		this.ewma = new EWMA(options.alpha ?? 0.25);
		this.detector = new AnomalyDetector(options);
		this.last = undefined;
	}
	update(value) {
		this.last = value;
		this.window.push(value);
		this.stats.update(value);
		this.ewma.update(value);
		const anomaly = this.detector.update(value);
		return {
			name: this.name,
			unit: this.unit,
			value,
			smoothed: round4(this.ewma.value),
			slope: round4(this.window.slope()),
			stats: this.stats.snapshot(),
			zscore: anomaly.zscore,
			anomaly: anomaly.anomaly
		};
	}
	metric(name) {
		switch (name) {
			case "value": return this.last;
			case "smoothed": return this.ewma.value;
			case "slope": return this.window.slope();
			case "zscore": return undefined === this.last ? undefined : this.stats.zscore(this.last);
			case "mean": return this.stats.mean;
			case "anomaly": return undefined === this.last ? 0 : (Math.abs(this.stats.zscore(this.last)) >= this.detector.zLimit ? 1 : 0);
			default: throw new Error(`unknown metric ${name}`);
		}
	}
}

class HeuristicEngine {
	constructor(options = {}) {
		this.channels = new Map;
		this.model = options.model ?? new LinearModel;
		this.featureOrder = options.featureOrder ?? [];
	}
	addChannel(name, options) {
		const channel = new Channel(name, options);
		this.channels.set(name, channel);
		return channel;
	}
	getChannel(name) {
		const channel = this.channels.get(name);
		if (!channel)
			throw new Error(`unknown channel ${name}`);
		return channel;
	}
	observe(sample) {
		const readings = [];
		let anomalies = 0;
		for (const name in sample) {
			let channel = this.channels.get(name);
			if (!channel)
				channel = this.addChannel(name);
			const reading = channel.update(sample[name]);
			if (reading.anomaly)
				anomalies += 1;
			readings.push(reading);
		}
		const prediction = this.#tryPredict();
		return {
			readings,
			anomalies,
			health: anomalies ? "degraded" : "nominal",
			prediction
		};
	}
	trainBaseline() {
		const baselines = {};
		for (const [name, channel] of this.channels) {
			if (channel.stats.count >= 2)
				baselines[name] = channel.detector.trainBaseline();
		}
		return baselines;
	}
	features() {
		const values = [];
		const names = this.featureOrder.length ? this.featureOrder : Array.from(this.channels.keys());
		for (let i = 0; i < names.length; i++) {
			const channel = this.channels.get(names[i]);
			values.push(undefined === channel?.last ? 0 : channel.last);
			values.push(channel ? channel.stats.zscore(channel.last ?? 0) : 0);
			values.push(channel ? channel.window.slope() : 0);
		}
		return { names, values };
	}
	#tryPredict() {
		if (!this.model.weights.length)
			return undefined;
		try {
			return this.model.predict(this.features().values);
		}
		catch {
			return undefined;
		}
	}
}

class PolicyEngine {
	constructor(rules = []) {
		this.rules = [];
		for (let i = 0; i < rules.length; i++)
			this.add(rules[i]);
	}
	add(rule) {
		if (!rule?.id || !rule.when || !rule.then)
			throw new Error("policy requires id, when, and then");
		const copy = {
			id: String(rule.id),
			enabled: false !== rule.enabled,
			when: Array.isArray(rule.when) ? rule.when.slice() : [rule.when],
			then: { ...rule.then }
		};
		const index = this.rules.findIndex(item => item.id === copy.id);
		if (index >= 0)
			this.rules[index] = copy;
		else
			this.rules.push(copy);
		return copy;
	}
	remove(id) {
		const index = this.rules.findIndex(item => item.id === id);
		if (index < 0)
			return false;
		this.rules.splice(index, 1);
		return true;
	}
	evaluate(engine) {
		const actions = [];
		for (let i = 0; i < this.rules.length; i++) {
			const rule = this.rules[i];
			if (!rule.enabled)
				continue;
			let matched = true;
			for (let j = 0; j < rule.when.length; j++) {
				const clause = rule.when[j];
				const channel = engine.channels.get(clause.sensor);
				if (!channel) {
					matched = false;
					break;
				}
				const metric = channel.metric(clause.metric ?? "value");
				if (!isFiniteNumber(metric) || !compare(clause.op ?? ">", metric, clause.value)) {
					matched = false;
					break;
				}
			}
			if (matched)
				actions.push({ id: rule.id, controller: rule.then.controller, value: rule.then.value });
		}
		return actions;
	}
}

export {
	OnlineStats,
	EWMA,
	RingBuffer,
	AnomalyDetector,
	LinearModel,
	Channel,
	HeuristicEngine,
	PolicyEngine
};
export default HeuristicEngine;
