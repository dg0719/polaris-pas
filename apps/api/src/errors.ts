/** Error carrying an HTTP status, so route handlers stay free of try/catch noise. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }

  static badRequest(message: string, code = 'bad_request'): ApiError {
    return new ApiError(400, code, message);
  }

  static unauthorized(message = 'Missing or invalid API key'): ApiError {
    return new ApiError(401, 'unauthorized', message);
  }

  static forbidden(message: string): ApiError {
    return new ApiError(403, 'forbidden', message);
  }

  static notFound(message: string): ApiError {
    return new ApiError(404, 'not_found', message);
  }

  static conflict(message: string, code = 'conflict'): ApiError {
    return new ApiError(409, code, message);
  }
}
