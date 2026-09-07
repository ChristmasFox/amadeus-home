export interface SensorWatchInput {
  radarWatchId: string;
  url: string;
  title: string;
  intervalSeconds: number;
  webhookUrl: string;
}

export interface SensorWatch {
  id: string;
  url?: string;
  paused?: boolean;
  raw?: unknown;
}

export interface SensorHealth {
  ok: boolean;
  status: string;
  details?: unknown;
}

export interface SensorClient {
  readonly id: string;
  createWatch(input: SensorWatchInput): Promise<SensorWatch>;
  updateWatch(sensorId: string, input: Partial<SensorWatchInput>): Promise<SensorWatch | undefined>;
  pauseWatch(sensorId: string): Promise<void>;
  resumeWatch(sensorId: string): Promise<void>;
  deleteWatch(sensorId: string): Promise<void>;
  getWatch(sensorId: string): Promise<SensorWatch | undefined>;
  health(): Promise<SensorHealth>;
}
