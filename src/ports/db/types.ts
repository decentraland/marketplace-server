import { PoolClient } from 'pg'
import { IPgComponent as IBasePgComponent } from '@dcl/pg-component'

export interface IPgComponent extends IBasePgComponent {
  withTransaction<T>(callback: (client: PoolClient) => Promise<T>, onError?: (error: unknown) => Promise<void>): Promise<T>
}
