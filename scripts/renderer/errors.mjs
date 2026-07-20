export class RendererError extends Error {
  constructor(reasonCode, message, details = []) {
    super(message);
    this.name = 'RendererError';
    this.reasonCode = reasonCode;
    this.details = Array.isArray(details) ? details : [details];
  }
}

export function blocked(reasonCode, message, details = []) {
  throw new RendererError(reasonCode, message, details);
}
