export interface KookDailyMessageBudget {
  reserve(reservationId: string): Promise<void>;
  markSent(reservationId: string): Promise<void>;
  release(reservationId: string): Promise<void>;
  prune(): Promise<number>;
}
