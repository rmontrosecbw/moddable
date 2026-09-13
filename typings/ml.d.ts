/*
* Copyright (c) 2026 Moddable Tech, Inc.
*
*   This file is part of the Moddable SDK Tools.
*
*   The Moddable SDK Tools is free software: you can redistribute it and/or modify
*   it under the terms of the GNU General Public License as published by
*   the Free Software Foundation, either version 3 of the License, or
*   (at your option) any later version.
*
*   The Moddable SDK Tools is distributed in the hope that it will be useful,
*   but WITHOUT ANY WARRANTY; without even the implied warranty of
*   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
*   GNU General Public License for more details.
*
*   You should have received a copy of the GNU General Public License
*   along with the Moddable SDK Tools.  If not, see <http://www.gnu.org/licenses/>.
*
*/

declare module "ml" {
  export class OnlineStats {
    count: number
    mean: number
    min?: number
    max?: number
    readonly variance: number
    readonly stddev: number
    reset(): void
    update(value: number): this
    zscore(value: number): number
    snapshot(): { count: number, mean: number, stddev: number, min?: number, max?: number }
  }
  export class EWMA {
    alpha: number
    value?: number
    constructor(alpha?: number)
    update(sample: number): number
  }
  export class RingBuffer {
    capacity: number
    length: number
    constructor(capacity?: number)
    push(value: number): number
    at(index: number): number | undefined
    toArray(): number[]
    slope(): number
    latest(): number | undefined
  }
  export class AnomalyDetector {
    zLimit: number
    minSamples: number
    stats: OnlineStats
    baseline?: object
    constructor(options?: { zLimit?: number, minSamples?: number })
    update(value: number): { value: number, zscore: number, anomaly: boolean, ready: boolean }
    trainBaseline(): object
    score(value: number): { value: number, zscore: number, anomaly: boolean, ready: boolean }
  }
  export class LinearModel {
    weights: number[]
    bias: number
    labels: string[]
    threshold: number
    constructor(options?: { weights?: number[], bias?: number, labels?: string[], threshold?: number })
    predict(features: number[]): { score: number, logit: number, label: string }
    fit(samples: { x: number[], y: number }[], options?: { learningRate?: number, epochs?: number }): object
    export(): { weights: number[], bias: number, labels: string[], threshold: number }
  }
  export class Channel {
    name: string
    unit?: string
    last?: number
    constructor(name: string, options?: object)
    update(value: number): object
    metric(name: string): number | undefined
  }
  export class HeuristicEngine {
    channels: Map<string, Channel>
    model: LinearModel
    constructor(options?: { model?: LinearModel, featureOrder?: string[] })
    addChannel(name: string, options?: object): Channel
    getChannel(name: string): Channel
    observe(sample: Record<string, number>): { readings: object[], anomalies: number, health: string, prediction?: object }
    trainBaseline(): object
    features(): { names: string[], values: number[] }
  }
  export class PolicyEngine {
    rules: object[]
    constructor(rules?: object[])
    add(rule: object): object
    remove(id: string): boolean
    evaluate(engine: HeuristicEngine): { id: string, controller: string, value: number }[]
  }
  export { HeuristicEngine as default }
}
