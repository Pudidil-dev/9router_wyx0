/**
 * Frame Streaming Engine
 * Captures browser screenshots and streams them via WebSocket for live monitoring
 * Inspired by enowxai's 4 FPS JPEG frame streaming
 */

import { randomUUID } from "crypto";

const DEFAULT_FRAME_RATE = 4; // FPS
const DEFAULT_JPEG_QUALITY = 65;
const MAX_FRAME_SIZE = 128 * 1024; // 128KB max per frame
const FRAME_BUFFER_SIZE = 3; // Keep last 3 frames for recovery

export class FrameStreamer {
  constructor(page, options = {}) {
    this.page = page;
    this.frameRate = options.frameRate || DEFAULT_FRAME_RATE;
    this.jpegQuality = options.jpegQuality || DEFAULT_JPEG_QUALITY;
    this.streamId = options.streamId || randomUUID();
    this.isActive = false;
    this.frameInterval = null;
    this.frameBuffer = [];
    this.listeners = new Set();
    this.stats = {
      framesSent: 0,
      bytesSent: 0,
      errors: 0,
      startedAt: null,
    };
  }

  /**
   * Start capturing and streaming frames
   */
  start() {
    if (this.isActive) return;
    
    this.isActive = true;
    this.stats.startedAt = Date.now();
    
    // Initial frame
    this._captureFrame().catch(() => {});
    
    // Continuous frame capture
    const intervalMs = Math.floor(1000 / this.frameRate);
    this.frameInterval = setInterval(() => {
      this._captureFrame().catch((err) => {
        this.stats.errors++;
        if (this.stats.errors > 10) {
          console.error("[FrameStreamer] Too many errors, stopping");
          this.stop();
        }
      });
    }, intervalMs);
  }

  /**
   * Stop frame streaming
   */
  stop() {
    this.isActive = false;
    if (this.frameInterval) {
      clearInterval(this.frameInterval);
      this.frameInterval = null;
    }
    this._emit({
      type: "frame_stream_ended",
      streamId: this.streamId,
      stats: this.getStats(),
    });
  }

  /**
   * Add a listener for frame events
   */
  addListener(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Get streaming statistics
   */
  getStats() {
    const duration = this.stats.startedAt 
      ? Date.now() - this.stats.startedAt 
      : 0;
    return {
      ...this.stats,
      duration,
      avgFrameSize: this.stats.framesSent > 0 
        ? Math.floor(this.stats.bytesSent / this.stats.framesSent) 
        : 0,
    };
  }

  /**
   * Capture a single frame
   */
  async _captureFrame() {
    if (!this.isActive || !this.page) return;

    try {
      const viewport = this.page.viewportSize() || { width: 1280, height: 720 };
      const startTime = Date.now();
      
      // Capture screenshot as JPEG
      const buffer = await this.page.screenshot({
        type: "jpeg",
        quality: this.jpegQuality,
        fullPage: false,
      });

      if (!buffer || buffer.length === 0) return;

      // Check frame size
      if (buffer.length > MAX_FRAME_SIZE) {
        // Try with lower quality
        const retryBuffer = await this.page.screenshot({
          type: "jpeg",
          quality: Math.floor(this.jpegQuality * 0.7),
          fullPage: false,
        });
        if (retryBuffer.length <= MAX_FRAME_SIZE) {
          buffer = retryBuffer;
        }
      }

      const base64 = buffer.toString("base64");
      const captureTime = Date.now() - startTime;
      
      const frame = {
        type: "frame",
        streamId: this.streamId,
        format: "jpeg",
        base64,
        width: viewport.width,
        height: viewport.height,
        size: buffer.length,
        captureTime,
        timestamp: Date.now(),
      };

      // Update buffer
      this.frameBuffer.push(frame);
      if (this.frameBuffer.length > FRAME_BUFFER_SIZE) {
        this.frameBuffer.shift();
      }

      // Update stats
      this.stats.framesSent++;
      this.stats.bytesSent += buffer.length;

      // Emit frame
      this._emit(frame);

    } catch (error) {
      this.stats.errors++;
      console.error("[FrameStreamer] Capture error:", error.message);
    }
  }

  /**
   * Emit event to all listeners
   */
  _emit(event) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("[FrameStreamer] Listener error:", error);
      }
    }
  }
}

/**
 * Create a frame streamer for a page
 */
export function createFrameStreamer(page, options = {}) {
  return new FrameStreamer(page, options);
}

/**
 * Capture a single frame as base64 JPEG
 */
export async function captureFrame(page, options = {}) {
  const quality = options.quality || DEFAULT_JPEG_QUALITY;
  
  try {
    const viewport = page.viewportSize() || { width: 1280, height: 720 };
    const buffer = await page.screenshot({
      type: "jpeg",
      quality,
      fullPage: false,
    });

    if (!buffer || buffer.length === 0) return null;

    return {
      base64: buffer.toString("base64"),
      width: viewport.width,
      height: viewport.height,
      size: buffer.length,
    };
  } catch (error) {
    console.error("[captureFrame] Error:", error.message);
    return null;
  }
}
