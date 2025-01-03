import { IMetricsComponent } from '@well-known-components/interfaces'
import { metricDeclarations as logsMetricsDeclarations } from '@well-known-components/logger'
import { validateMetricsDeclaration, getDefaultHttpMetrics } from '@well-known-components/metrics'
import { metricDeclarations as graphMetrics } from '@well-known-components/thegraph-component'

export const metricDeclarations = {
  ...getDefaultHttpMetrics(),
  ...logsMetricsDeclarations,
  ...graphMetrics,
  test_ping_counter: {
    help: 'Count calls to ping',
    type: IMetricsComponent.CounterType,
    labelNames: ['pathname']
  }
}

// type assertions
validateMetricsDeclaration(metricDeclarations)
