/**
 * Simple In-Memory Metrics Collector
 * Tracks request latencies, queue depths, error rates, and LLM costs.
 * Can be replaced with Prometheus/DataDog/etc. in production.
 */

class MetricsCollector {
  constructor() {
    this.counters = {};
    this.histograms = {};
    this.gauges = {};
    this.startTime = Date.now();
  }

  // Increment a counter
  inc(name, labels = {}, value = 1) {
    const key = this._makeKey(name, labels);
    this.counters[key] = (this.counters[key] || 0) + value;
  }

  // Set a gauge value
  set(name, labels = {}, value) {
    const key = this._makeKey(name, labels);
    this.gauges[key] = value;
  }

  // Record a histogram observation (for latencies, etc.)
  observe(name, labels = {}, value) {
    const key = this._makeKey(name, labels);
    if (!this.histograms[key]) {
      this.histograms[key] = {
        count: 0,
        sum: 0,
        min: Infinity,
        max: -Infinity,
        buckets: { 10: 0, 50: 0, 100: 0, 250: 0, 500: 0, 1000: 0, 2500: 0, 5000: 0, 10000: 0 },
      };
    }
    const h = this.histograms[key];
    h.count++;
    h.sum += value;
    h.min = Math.min(h.min, value);
    h.max = Math.max(h.max, value);

    // Update buckets
    for (const bucket of Object.keys(h.buckets)) {
      if (value <= parseFloat(bucket)) {
        h.buckets[bucket]++;
      }
    }
  }

  // Helper to create timer
  timer(name, labels = {}) {
    const start = process.hrtime.bigint();
    return () => {
      const end = process.hrtime.bigint();
      const durationMs = Number(end - start) / 1_000_000;
      this.observe(name, labels, durationMs);
      return durationMs;
    };
  }

  // Get all metrics as JSON
  getMetrics() {
    const uptimeMs = Date.now() - this.startTime;
    return {
      uptime_ms: uptimeMs,
      counters: this.counters,
      gauges: this.gauges,
      histograms: Object.fromEntries(
        Object.entries(this.histograms).map(([key, h]) => [
          key,
          {
            count: h.count,
            sum: h.sum,
            avg: h.count > 0 ? h.sum / h.count : 0,
            min: h.min === Infinity ? 0 : h.min,
            max: h.max === -Infinity ? 0 : h.max,
            p50: this._estimatePercentile(h, 0.5),
            p95: this._estimatePercentile(h, 0.95),
            p99: this._estimatePercentile(h, 0.99),
          },
        ])
      ),
    };
  }

  // Reset all metrics (useful for testing)
  reset() {
    this.counters = {};
    this.histograms = {};
    this.gauges = {};
    this.startTime = Date.now();
  }

  _makeKey(name, labels) {
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    return labelStr ? `${name}{${labelStr}}` : name;
  }

  _estimatePercentile(histogram, percentile) {
    const target = histogram.count * percentile;
    const buckets = Object.entries(histogram.buckets)
      .map(([k, v]) => [parseFloat(k), v])
      .sort((a, b) => a[0] - b[0]);

    for (const [bound, count] of buckets) {
      if (count >= target) {
        return bound;
      }
    }
    return histogram.max === -Infinity ? 0 : histogram.max;
  }
}

// Singleton instance
export const metrics = new MetricsCollector();

// Pre-defined metric names for consistency
export const METRIC_NAMES = {
  // HTTP metrics
  HTTP_REQUEST_DURATION: 'http_request_duration_ms',
  HTTP_REQUEST_TOTAL: 'http_requests_total',
  HTTP_REQUEST_ERRORS: 'http_request_errors_total',

  // Database metrics
  DB_QUERY_DURATION: 'db_query_duration_ms',
  DB_QUERY_TOTAL: 'db_queries_total',
  DB_QUERY_ERRORS: 'db_query_errors_total',
  DB_POOL_SIZE: 'db_pool_size',
  DB_POOL_IDLE: 'db_pool_idle',
  DB_POOL_WAITING: 'db_pool_waiting',

  // LLM metrics
  LLM_REQUEST_DURATION: 'llm_request_duration_ms',
  LLM_REQUEST_TOTAL: 'llm_requests_total',
  LLM_REQUEST_ERRORS: 'llm_request_errors_total',
  LLM_TOKENS_INPUT: 'llm_tokens_input_total',
  LLM_TOKENS_OUTPUT: 'llm_tokens_output_total',
  LLM_COST_USD: 'llm_cost_usd_total',

  // Queue metrics
  QUEUE_JOBS_TOTAL: 'queue_jobs_total',
  QUEUE_JOBS_COMPLETED: 'queue_jobs_completed_total',
  QUEUE_JOBS_FAILED: 'queue_jobs_failed_total',
  QUEUE_DEPTH: 'queue_depth',
  QUEUE_JOB_DURATION: 'queue_job_duration_ms',

  // Business metrics
  OPTIMIZE_STEP_DURATION: 'optimize_step_duration_ms',
  OPTIMIZE_STEP_TOTAL: 'optimize_step_total',
  CALLS_EVALUATED: 'calls_evaluated_total',
  RUBRICS_GENERATED: 'rubrics_generated_total',
  TESTS_RUN: 'tests_run_total',

  // Rate limiting
  RATE_LIMIT_HIT: 'rate_limit_hit_total',
};

export default metrics;
