import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';

/**
 * Gestion d'erreurs centralisée.
 *
 * Toutes les réponses d'erreur suivent la même forme, en français, pour que le
 * frontend n'ait qu'un seul cas à traiter :
 *
 *   { "error": { "code": "not_found", "message": "…", "details": … } }
 */

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export class ApiError extends HTTPException {
  readonly code: string;
  readonly details: unknown;

  constructor(status: ContentfulStatusCode, code: string, message: string, details?: unknown) {
    super(status, { message });
    this.code = code;
    this.details = details;
  }
}

export const notFound = (message: string) => new ApiError(404, 'not_found', message);
export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, 'bad_request', message, details);
export const conflict = (message: string, details?: unknown) =>
  new ApiError(409, 'conflict', message, details);
export const preconditionFailed = (message: string, details?: unknown) =>
  new ApiError(412, 'precondition_failed', message, details);

/** Gestionnaire `onError` de l'application Hono. */
export function handleError(error: Error, c: Context) {
  if (error instanceof ApiError) {
    const body: ApiErrorBody = {
      error: { code: error.code, message: error.message, details: error.details },
    };
    return c.json(body, error.status);
  }

  if (error instanceof HTTPException) {
    return c.json<ApiErrorBody>(
      { error: { code: 'http_error', message: error.message } },
      error.status,
    );
  }

  if (error instanceof ZodError) {
    return c.json<ApiErrorBody>(
      {
        error: {
          code: 'validation_error',
          message: 'Les données envoyées sont invalides.',
          details: error.flatten(),
        },
      },
      400,
    );
  }

  // Erreur inattendue : on la journalise intégralement côté serveur, mais on
  // n'expose au client qu'un message générique.
  console.error('[api] erreur non gérée :', error);
  return c.json<ApiErrorBody>(
    {
      error: {
        code: 'internal_error',
        message: 'Une erreur interne est survenue.',
      },
    },
    500,
  );
}
