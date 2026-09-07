export class RadarError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode = 400,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'RadarError';
  }
}

export class UnsupportedCapabilityError extends RadarError {
  constructor(source: string, type: string) {
    super(`Source ${source} does not support ${type} watch`, 'UNSUPPORTED_CAPABILITY', 422, { source, type });
  }
}

export class SourceFetchError extends RadarError {
  constructor(message: string, details?: unknown) {
    super(message, 'SOURCE_FETCH_FAILED', 502, details);
  }
}

export class SensorUnavailableError extends RadarError {
  constructor(message: string, details?: unknown) {
    super(message, 'SENSOR_UNAVAILABLE', 503, details);
  }
}
