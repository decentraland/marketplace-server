import { IMetricsComponent } from '@well-known-components/interfaces'
import { metricDeclarations as logsMetricsDeclarations } from '@well-known-components/logger'
import { getDefaultHttpMetrics } from '@dcl/http-server'
import { validateMetricsDeclaration } from '@dcl/metrics'
import { metricDeclarations as graphMetrics } from '@dcl/thegraph-component'

export const metricDeclarations = {
  ...getDefaultHttpMetrics(),
  ...logsMetricsDeclarations,
  ...graphMetrics,
  test_ping_counter: {
    help: 'Count calls to ping',
    type: IMetricsComponent.CounterType,
    labelNames: ['pathname']
  },
  // Gauges rather than counters: what matters is the shape of the LAST rebuild. A `built_at` that stops
  // advancing is the alertable condition, and these make it visible without querying the table.
  suggestions_neighbors_build_duration_seconds: {
    help: 'Duration of the last item-neighbours rebuild',
    type: IMetricsComponent.GaugeType
  },
  suggestions_neighbors_rows: {
    help: 'Rows written by the last item-neighbours rebuild',
    type: IMetricsComponent.GaugeType
  },
  suggestions_neighbors_peak_rss_bytes: {
    help: 'Peak resident set size observed during the last item-neighbours rebuild',
    type: IMetricsComponent.GaugeType
  }
}

// type assertions
validateMetricsDeclaration(metricDeclarations)
