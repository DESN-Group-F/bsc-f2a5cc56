export interface ServiceConfiguration { origin: string | null; businessDataCodecs?: Array<'gzip-base64-v1'> }
export interface ServiceRequest {
  path: string;
  method: 'GET' | 'POST';
  body?: string;
  headers?: { 'Content-Type'?: string; Accept?: string; 'content-type'?: string; accept?: string };
}
export interface ServiceResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  encoding: 'utf8' | 'base64';
}
export interface BatteryServicePlugin {
  getConfiguration(): Promise<ServiceConfiguration>;
  configure(options: { origin: string }): Promise<ServiceConfiguration>;
  clearSession(): Promise<void>;
  loadBusinessData(): Promise<{ data: string | null }>;
  saveBusinessData(options: { data: string; codec?: 'gzip-base64-v1' }): Promise<void>;
  request(options: ServiceRequest): Promise<ServiceResponse>;
  /** iOS only: requests foreground UIKit impact feedback; hardware output is not guaranteed. */
  haptic(options: { strength: 'light' | 'medium' }): Promise<void>;
}
export declare const BatteryService: BatteryServicePlugin;
