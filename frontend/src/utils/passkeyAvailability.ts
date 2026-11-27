/**
 * Whether passkeys can be used on the current page, and why not.
 *
 * - `insecureContext`: the page is not served over HTTPS or localhost, or it was
 *   opened by an IP address. Browsers hide WebAuthn on insecure pages and refuse
 *   IP addresses as the relying party, so the fix is how the dashboard is opened.
 * - `unsupported`: the page qualifies, but the browser has no WebAuthn support.
 */
export type PasskeyAvailability = 'available' | 'insecureContext' | 'unsupported';

export interface PasskeyEnvironment {
  isSecureContext: boolean;
  hostname: string;
  webAuthnSupported: boolean;
}

const IPV4_HOST = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** True for an IPv4 or IPv6 literal, as found in `URL.hostname` (IPv6 keeps its brackets). */
export const isIpAddressHost = (hostname: string): boolean =>
  IPV4_HOST.test(hostname) || (hostname.startsWith('[') && hostname.endsWith(']'));

export const classifyPasskeyAvailability = ({
  isSecureContext,
  hostname,
  webAuthnSupported,
}: PasskeyEnvironment): PasskeyAvailability => {
  if (!isSecureContext || isIpAddressHost(hostname)) return 'insecureContext';
  return webAuthnSupported ? 'available' : 'unsupported';
};
