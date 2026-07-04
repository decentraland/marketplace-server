import { IHttpServerComponent } from '@dcl/core-commons'

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
      // Explicitly-thrown, expected errors. Log 5xx (a real server fault); 4xx are normal control flow.
      if (error.code >= 500) console.error(`[asJSON] HttpError ${error.code}:`, error)
      return {
        status: error.code,
        body: error.message
      }
    } else {
      // Unexpected error → 500. Log the FULL error (message + stack) so failures are debuggable from
      // the server logs, not just a bare 500 in the access log. (The message is also returned in the
      // body, but server logs are what you read when a request 500s.)
      console.error('[asJSON] unhandled error → 500:', error)
      return {
        status: 500,
        body: error?.message ?? 'Internal server error'
      }
    }
  }
}
