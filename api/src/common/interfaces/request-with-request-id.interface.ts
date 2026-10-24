import { Request } from 'express';

/**
 * A request enriched by the pino-http middleware.
 *
 * `req.id` is declared by pino-http's own type augmentation
 * (`declare module 'http' { interface IncomingMessage { id: ReqId } }`),
 * so it is already typed here — it only needs to be narrowed to a string.
 */
export type RequestWithRequestId = Request & { id: string | number };
