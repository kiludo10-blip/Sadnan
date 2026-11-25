import { CaptureError, CapturedPacket } from '../types/capture';

export class PacketRingBuffer {
  private capacity: number;
  private buffer: CapturedPacket[] = [];
  private droppedCount = 0;
  private totalEnqueued = 0;
  private errors: CaptureError[] = [];

  constructor(initialCapacity = 2500) {
    this.capacity = Math.max(500, Math.min(25000, initialCapacity));
  }

  setCapacity(nextCapacity: number) {
    const clamped = Math.max(500, Math.min(25000, nextCapacity));
    this.capacity = clamped;
    if (this.buffer.length > clamped) {
      const overflow = this.buffer.length - clamped;
      this.buffer = this.buffer.slice(overflow);
      this.droppedCount += overflow;
      this.recordError(
        'RING_RESIZE_TRIM',
        `Ring buffer resized to ${clamped} packets; evicted ${overflow} oldest frames.`
      );
    }
  }

  getCapacity(): number {
    return this.capacity;
  }

  pushBatch(packets: CapturedPacket[]): { accepted: number; dropped: number } {
    let accepted = 0;
    let dropped = 0;
    for (const pkt of packets) {
      this.totalEnqueued += 1;
      if (this.buffer.length >= this.capacity) {
        // Non-blocking ring overwrite: drop oldest frame and increment explicit drop counter
        this.buffer.shift();
        this.droppedCount += 1;
        dropped += 1;
      }
      this.buffer.push(pkt);
      accepted += 1;
    }
    if (dropped > 0) {
      this.recordError(
        'RING_OVERFLOW_DROP',
        `Ring buffer capacity (${this.capacity}) reached; rotated ${dropped} packet(s).`
      );
    }
    return { accepted, dropped };
  }

  recordError(code: string, message: string) {
    this.errors.unshift({
      id: `err-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestampMs: Date.now(),
      code,
      message,
    });
    if (this.errors.length > 100) {
      this.errors.length = 100;
    }
  }

  getAll(): CapturedPacket[] {
    return this.buffer;
  }

  getDroppedCount(): number {
    return this.droppedCount;
  }

  getTotalEnqueued(): number {
    return this.totalEnqueued;
  }

  getErrors(): CaptureError[] {
    return this.errors;
  }

  clear() {
    this.buffer = [];
    this.droppedCount = 0;
    this.totalEnqueued = 0;
    this.errors = [];
  }
}
