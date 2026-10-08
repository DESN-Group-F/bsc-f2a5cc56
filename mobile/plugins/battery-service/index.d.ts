export interface ServiceConfiguration { origin: string | null }
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
  saveBusinessData(options: { data: string }): Promise<void>;
  request(options: ServiceRequest): Promise<ServiceResponse>;
}
export declare const BatteryService: BatteryServicePlugin;
