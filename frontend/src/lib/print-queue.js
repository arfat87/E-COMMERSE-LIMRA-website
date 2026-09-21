/**
 * LIMRA Restaurant POS V2 — Resilient Print Queue & Retry Engine
 * Ensures zero lost print jobs if a printer is offline, out of paper, or disconnected.
 * Persists in localStorage and surfaces retryable alerts.
 */

const STORAGE_KEY = 'limra_print_queue';
const MAX_HISTORY = 30;

class PrintQueueManager {
  constructor() {
    this.jobs = this.loadFromStorage();
    this.listeners = new Set();
    this.activeExecutor = null;
  }

  loadFromStorage() {
    try {
      if (typeof localStorage === 'undefined') return [];
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.warn('[PrintQueue] Failed to load queue from storage:', e);
      return [];
    }
  }

  saveToStorage() {
    try {
      if (typeof localStorage === 'undefined') return;
      // Keep only recent jobs
      const trimmed = this.jobs.slice(0, MAX_HISTORY);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch (e) {
      console.warn('[PrintQueue] Failed to save queue to storage:', e);
    }
  }

  setExecutor(executor) {
    this.activeExecutor = executor;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.jobs);
    return () => this.listeners.delete(listener);
  }

  notify() {
    this.saveToStorage();
    for (const listener of this.listeners) {
      try {
        listener(this.jobs);
      } catch (err) {
        console.error('[PrintQueue] Listener error:', err);
      }
    }
  }

  /**
   * Enqueue a new print job and attempt immediate execution
   * @param {Object} jobData - { orderId, orderNumber, type, paperWidth, payload }
   * @param {Function} [customExecutor] - Optional override print execution function
   * @returns {Promise<Object>} The enqueued job
   */
  async enqueue(jobData, customExecutor = null) {
    const job = {
      id: `print-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      orderId: String(jobData.orderId || ''),
      orderNumber: String(jobData.orderNumber || '—'),
      type: jobData.type || 'BILL', // 'BILL' or 'KOT'
      paperWidth: jobData.paperWidth || 80,
      status: 'pending', // 'pending' | 'printing' | 'printed' | 'failed'
      error: null,
      attempts: 0,
      maxRetries: jobData.maxRetries || 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      payload: jobData.payload || null
    };

    // Prepend to queue
    this.jobs.unshift(job);
    this.notify();

    const executor = customExecutor || this.activeExecutor;
    if (executor) {
      return this.executeJob(job.id, executor);
    }
    return job;
  }

  /**
   * Executes a specific job
   */
  async executeJob(jobId, executor) {
    const job = this.jobs.find(j => j.id === jobId);
    if (!job) return null;

    job.status = 'printing';
    job.attempts += 1;
    job.updatedAt = new Date().toISOString();
    this.notify();

    try {
      const result = await executor(job);
      if (result !== false && (!result || result.success !== false)) {
        job.status = 'printed';
        job.error = null;
        job.updatedAt = new Date().toISOString();
        this.notify();
        return job;
      }
      throw new Error(result?.error || 'Printer driver returned failure or timed out');
    } catch (err) {
      console.error(`[PrintQueue] Job ${jobId} (Order #${job.orderNumber}) print failed:`, err);
      job.status = 'failed';
      job.error = err.message || 'Printer offline or disconnected';
      job.updatedAt = new Date().toISOString();
      this.notify();
      return job;
    }
  }

  /**
   * Retry a specific failed job
   */
  async retry(jobId, customExecutor = null) {
    const executor = customExecutor || this.activeExecutor;
    if (!executor) {
      console.warn('[PrintQueue] Cannot retry: no active print executor registered');
      return null;
    }
    return this.executeJob(jobId, executor);
  }

  /**
   * Retry all currently failed jobs
   */
  async retryAllFailed(customExecutor = null) {
    const executor = customExecutor || this.activeExecutor;
    if (!executor) return;
    const failedJobs = this.jobs.filter(j => j.status === 'failed');
    for (const job of failedJobs) {
      await this.executeJob(job.id, executor);
    }
  }

  /**
   * Remove a job from queue
   */
  removeJob(jobId) {
    this.jobs = this.jobs.filter(j => j.id !== jobId);
    this.notify();
  }

  /**
   * Clear all successfully printed jobs older than 10 minutes
   */
  clearPrinted() {
    const cutoff = Date.now() - 10 * 60 * 1000;
    this.jobs = this.jobs.filter(j => {
      if (j.status !== 'printed') return true;
      return new Date(j.updatedAt).getTime() > cutoff;
    });
    this.notify();
  }

  getFailedCount() {
    return this.jobs.filter(j => j.status === 'failed').length;
  }

  getJobs() {
    return this.jobs;
  }
}

export const printQueue = new PrintQueueManager();
