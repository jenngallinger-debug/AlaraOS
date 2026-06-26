/**
 * Alara OS — Stub Communication Delivery Adapter
 *
 * Used in development and tests. Records delivery attempts without
 * contacting any external service.
 *
 * Replace with EmailAdapter / SMSAdapter / FaxAdapter for production.
 * The CommunicationEngine never changes — only the adapter swaps.
 */

import { Communication, CommunicationChannel, CommunicationDeliveryAdapter, DeliveryResult } from './types';

export class StubDeliveryAdapter implements CommunicationDeliveryAdapter {
  readonly name = 'stub';
  readonly supportedChannels: readonly CommunicationChannel[] = [
    'internal', 'patient', 'family', 'physician', 'referral_source',
  ];

  readonly delivered: Communication[] = [];
  readonly failed: Communication[] = [];

  /** If set to true, next delivery attempt will fail */
  simulateFailure = false;
  failureReason = 'Simulated delivery failure';

  async deliver(communication: Communication): Promise<DeliveryResult> {
    if (this.simulateFailure) {
      this.failed.push(communication);
      return { success: false, adapterName: this.name, failureReason: this.failureReason };
    }
    this.delivered.push(communication);
    return { success: true, adapterName: this.name, externalReference: `stub-${communication.id}` };
  }

  reset(): void {
    this.delivered.length = 0;
    this.failed.length = 0;
    this.simulateFailure = false;
  }
}
