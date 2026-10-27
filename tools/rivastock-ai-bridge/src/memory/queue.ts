export interface MemoryQueueEntry {
  jobId: string;
  chatId: string;
  input: string;
  output: string;
  shouldExtract: boolean;
  summaryDue: boolean;
  metric: 'skipped_prefilter' | null;
}

export class MemoryTurnQueue {
  private readonly items: MemoryQueueEntry[] = [];

  constructor(private readonly maxPending = 20, private readonly maxBatch = 6) {}

  get length(): number { return this.items.length; }

  enqueue(item: MemoryQueueEntry): boolean {
    if (this.items.length >= this.maxPending) {
      const cleanupOnly = this.items.findIndex((pending) => !pending.shouldExtract && !pending.summaryDue);
      if (cleanupOnly < 0) return false;
      this.items.splice(cleanupOnly, 1);
    }
    this.items.push({ ...item });
    return true;
  }

  takeNextBatch(): MemoryQueueEntry[] {
    const first = this.items[0];
    if (!first) return [];
    const batch: MemoryQueueEntry[] = [];
    for (let index = 0; index < this.items.length && batch.length < this.maxBatch;) {
      const item = this.items[index];
      if (item?.chatId === first.chatId) {
        batch.push(item);
        this.items.splice(index, 1);
      } else {
        index += 1;
      }
    }
    return batch;
  }
}
