import { TextPlatformRenderer } from '../core/renderer.js';

/** Text-only renderer for the first Cloud API integration phase. */
export class WhatsAppRenderer extends TextPlatformRenderer {
  constructor() {
    super('whatsapp');
  }
}
