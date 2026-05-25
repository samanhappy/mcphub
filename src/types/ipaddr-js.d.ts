declare module 'ipaddr.js' {
  export interface IPv4 {
    toString(): string;
  }

  export interface IPv6 {
    isIPv4MappedAddress(): boolean;
    toIPv4Address(): IPv4;
    toString(): string;
  }

  export type IPAddress = IPv4 | IPv6;

  export function isValid(address: string): boolean;
  export function parse(address: string): IPAddress;

  export const IPv6: {
    prototype: IPv6;
    new (...args: any[]): IPv6;
  };

  const ipaddr: {
    isValid: typeof isValid;
    parse: typeof parse;
    IPv6: typeof IPv6;
  };

  export default ipaddr;
}
