export type MetricLabelValue = string | number | boolean;
export type MetricLabels = Readonly<Record<string, MetricLabelValue>>;

export interface MetricDefinition {
  readonly name: string;
  readonly help: string;
  readonly labelNames?: readonly string[];
}

export interface HistogramDefinition extends MetricDefinition {
  readonly buckets: readonly number[];
}

export interface Counter {
  increment(value?: number, labels?: MetricLabels): void;
  get(labels?: MetricLabels): number;
}

export interface Gauge {
  set(value: number, labels?: MetricLabels): void;
  increment(value?: number, labels?: MetricLabels): void;
  decrement(value?: number, labels?: MetricLabels): void;
  get(labels?: MetricLabels): number;
}

export interface Histogram {
  observe(value: number, labels?: MetricLabels): void;
}

interface NormalizedLabels {
  readonly values: readonly string[];
  readonly key: string;
}

interface PrometheusMetric {
  readonly name: string;
  render(): readonly string[];
}

interface HistogramState {
  readonly bucketCounts: number[];
  count: number;
  sum: number;
}

const METRIC_NAME = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
const LABEL_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const SENSITIVE_LABEL = "[redacted]";

function assertFinite(value: number, operation: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${operation} requires a finite number`);
  }
}

function safeHelp(help: string): string {
  const normalized = help.replace(/[\r\n]+/g, " ").trim();
  if (normalized.length === 0) {
    throw new TypeError("metric help must not be empty");
  }
  return normalized;
}

function normalizeLabelValue(value: MetricLabelValue): string {
  const raw = String(value);
  if (
    raw.length > 80 ||
    /(?:https?|wss?|postgres(?:ql)?|redis):\/\//i.test(raw) ||
    /\b(?:Bearer|Basic)\s+/i.test(raw) ||
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(raw) ||
    /^0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(raw)
  ) {
    return SENSITIVE_LABEL;
  }
  return raw;
}

function escapeLabel(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/"/g, '\\"');
}

function formatNumber(value: number): string {
  if (value === Number.POSITIVE_INFINITY) return "+Inf";
  if (value === Number.NEGATIVE_INFINITY) return "-Inf";
  if (Number.isNaN(value)) return "NaN";
  return String(value);
}

function formatLabels(
  names: readonly string[],
  values: readonly string[],
  extraName?: string,
  extraValue?: string,
): string {
  const pairs = names.map(
    (name, index) => `${name}="${escapeLabel(values[index] ?? "")}"`,
  );
  if (extraName !== undefined && extraValue !== undefined) {
    pairs.push(`${extraName}="${escapeLabel(extraValue)}"`);
  }
  return pairs.length === 0 ? "" : `{${pairs.join(",")}}`;
}

abstract class BaseMetric implements PrometheusMetric {
  public readonly name: string;
  protected readonly help: string;
  protected readonly labelNames: readonly string[];

  protected constructor(definition: MetricDefinition) {
    if (!METRIC_NAME.test(definition.name)) {
      throw new TypeError(`invalid metric name: ${definition.name}`);
    }
    this.name = definition.name;
    this.help = safeHelp(definition.help);
    this.labelNames = [...(definition.labelNames ?? [])];
    const uniqueLabels = new Set(this.labelNames);
    if (
      uniqueLabels.size !== this.labelNames.length ||
      this.labelNames.some((name) => !LABEL_NAME.test(name))
    ) {
      throw new TypeError(`invalid labels for metric: ${definition.name}`);
    }
  }

  public abstract render(): readonly string[];

  protected normalizeLabels(labels: MetricLabels = {}): NormalizedLabels {
    const actualNames = Object.keys(labels).sort();
    const expectedNames = [...this.labelNames].sort();
    if (
      actualNames.length !== expectedNames.length ||
      actualNames.some((name, index) => name !== expectedNames[index])
    ) {
      throw new TypeError(
        `label set mismatch for ${this.name}; expected ${expectedNames.join(",")}`,
      );
    }
    const values = this.labelNames.map((name) =>
      normalizeLabelValue(labels[name] ?? ""),
    );
    return { values, key: JSON.stringify(values) };
  }

  protected header(type: "counter" | "gauge" | "histogram"): string[] {
    return [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} ${type}`];
  }
}

class CounterMetric extends BaseMetric implements Counter {
  private readonly values = new Map<string, {
    readonly labels: readonly string[];
    value: number;
  }>();

  public constructor(definition: MetricDefinition) {
    super(definition);
  }

  public increment(value = 1, labels: MetricLabels = {}): void {
    assertFinite(value, "counter increment");
    if (value < 0) throw new RangeError("counter increment must be non-negative");
    const normalized = this.normalizeLabels(labels);
    const state = this.values.get(normalized.key) ?? {
      labels: normalized.values,
      value: 0,
    };
    state.value += value;
    this.values.set(normalized.key, state);
  }

  public get(labels: MetricLabels = {}): number {
    const normalized = this.normalizeLabels(labels);
    return this.values.get(normalized.key)?.value ?? 0;
  }

  public render(): readonly string[] {
    const lines = this.header("counter");
    const samples = [...this.values.values()].sort((left, right) =>
      JSON.stringify(left.labels).localeCompare(JSON.stringify(right.labels)),
    );
    for (const sample of samples) {
      lines.push(
        `${this.name}${formatLabels(this.labelNames, sample.labels)} ${formatNumber(sample.value)}`,
      );
    }
    return lines;
  }
}

class GaugeMetric extends BaseMetric implements Gauge {
  private readonly values = new Map<string, {
    readonly labels: readonly string[];
    value: number;
  }>();

  public constructor(definition: MetricDefinition) {
    super(definition);
  }

  public set(value: number, labels: MetricLabels = {}): void {
    assertFinite(value, "gauge set");
    const normalized = this.normalizeLabels(labels);
    this.values.set(normalized.key, {
      labels: normalized.values,
      value,
    });
  }

  public increment(value = 1, labels: MetricLabels = {}): void {
    assertFinite(value, "gauge increment");
    const normalized = this.normalizeLabels(labels);
    const state = this.values.get(normalized.key) ?? {
      labels: normalized.values,
      value: 0,
    };
    state.value += value;
    this.values.set(normalized.key, state);
  }

  public decrement(value = 1, labels: MetricLabels = {}): void {
    assertFinite(value, "gauge decrement");
    this.increment(-value, labels);
  }

  public get(labels: MetricLabels = {}): number {
    const normalized = this.normalizeLabels(labels);
    return this.values.get(normalized.key)?.value ?? 0;
  }

  public render(): readonly string[] {
    const lines = this.header("gauge");
    const samples = [...this.values.values()].sort((left, right) =>
      JSON.stringify(left.labels).localeCompare(JSON.stringify(right.labels)),
    );
    for (const sample of samples) {
      lines.push(
        `${this.name}${formatLabels(this.labelNames, sample.labels)} ${formatNumber(sample.value)}`,
      );
    }
    return lines;
  }
}

class HistogramMetric extends BaseMetric implements Histogram {
  private readonly buckets: readonly number[];
  private readonly values = new Map<string, {
    readonly labels: readonly string[];
    readonly state: HistogramState;
  }>();

  public constructor(definition: HistogramDefinition) {
    super(definition);
    if (this.labelNames.includes("le")) {
      throw new TypeError(`histogram ${this.name} reserves the le label`);
    }
    const buckets = [...definition.buckets].sort((left, right) => left - right);
    if (
      buckets.length === 0 ||
      buckets.some((bucket) => !Number.isFinite(bucket)) ||
      new Set(buckets).size !== buckets.length
    ) {
      throw new TypeError(`invalid buckets for histogram: ${this.name}`);
    }
    this.buckets = buckets;
  }

  public observe(value: number, labels: MetricLabels = {}): void {
    assertFinite(value, "histogram observation");
    const normalized = this.normalizeLabels(labels);
    const existing = this.values.get(normalized.key);
    const state: HistogramState = existing?.state ?? {
      bucketCounts: this.buckets.map(() => 0),
      count: 0,
      sum: 0,
    };
    this.buckets.forEach((bucket, index) => {
      if (value <= bucket) {
        state.bucketCounts[index] = (state.bucketCounts[index] ?? 0) + 1;
      }
    });
    state.count += 1;
    state.sum += value;
    this.values.set(normalized.key, {
      labels: existing?.labels ?? normalized.values,
      state,
    });
  }

  public render(): readonly string[] {
    const lines = this.header("histogram");
    const samples = [...this.values.values()].sort((left, right) =>
      JSON.stringify(left.labels).localeCompare(JSON.stringify(right.labels)),
    );
    for (const sample of samples) {
      this.buckets.forEach((bucket, index) => {
        lines.push(
          `${this.name}_bucket${formatLabels(
            this.labelNames,
            sample.labels,
            "le",
            formatNumber(bucket),
          )} ${sample.state.bucketCounts[index] ?? 0}`,
        );
      });
      lines.push(
        `${this.name}_bucket${formatLabels(
          this.labelNames,
          sample.labels,
          "le",
          "+Inf",
        )} ${sample.state.count}`,
      );
      lines.push(
        `${this.name}_sum${formatLabels(this.labelNames, sample.labels)} ${formatNumber(sample.state.sum)}`,
      );
      lines.push(
        `${this.name}_count${formatLabels(this.labelNames, sample.labels)} ${sample.state.count}`,
      );
    }
    return lines;
  }
}

export class MetricsRegistry {
  public readonly contentType =
    "text/plain; version=0.0.4; charset=utf-8";

  private readonly metrics = new Map<string, PrometheusMetric>();

  public counter(definition: MetricDefinition): Counter {
    const metric = new CounterMetric(definition);
    this.add(metric);
    return metric;
  }

  public gauge(definition: MetricDefinition): Gauge {
    const metric = new GaugeMetric(definition);
    this.add(metric);
    return metric;
  }

  public histogram(definition: HistogramDefinition): Histogram {
    const metric = new HistogramMetric(definition);
    this.add(metric);
    return metric;
  }

  public render(): string {
    const lines = [...this.metrics.values()]
      .sort((left, right) => left.name.localeCompare(right.name))
      .flatMap((metric) => metric.render());
    return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
  }

  private add(metric: PrometheusMetric): void {
    if (this.metrics.has(metric.name)) {
      throw new TypeError(`metric already registered: ${metric.name}`);
    }
    this.metrics.set(metric.name, metric);
  }
}
