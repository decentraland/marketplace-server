import { IPgComponent as IBasePgComponent } from '@well-known-components/pg-component'
import { PoolClient } from 'pg'

export interface IPgComponent extends IBasePgComponent {
  withTransaction<T>(callback: (client: PoolClient) => Promise<T>, onError?: (error: unknown) => Promise<void>): Promise<T>
}
