import { IHttpServerComponent } from '@well-known-components/interfaces'
import { HeadersInit } from 'node-fetch'

export class HttpError extends Error {
  constructor(message: string, public code: number) {
    super(message)

    // Set the prototype explicitly.
    Object.setPrototypeOf(this, HttpError.prototype)
  }
}

export async function asJSON(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handle: () => Promise<any>,
  headers?: HeadersInit,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extraHeaders?: (data: any) => HeadersInit
): Promise<IHttpServerComponent.IResponse> {
  try {
    const result = await handle()
    return {
      status: 200,
      body: result,
      headers: {
        ...headers,
        ...(extraHeaders ? extraHeaders(result) : {})
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    if (error instanceof HttpError) {
      return {
        status: error.code,
        body: error.message
      }
    } else {
      return {
        status: 500,
        body: error.message
      }
    }
  }
}
