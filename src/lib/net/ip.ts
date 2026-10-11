/**
 * IP address security validator.
 *
 * Implements a strict default-deny policy using ipaddr.js.
 * Only public unicast IP addresses are allowed; all private, loopback,
 * link-local, carrier-grade NAT, multicast, reserved, or special-purpose
 * addresses are rejected to prevent SSRF (Server-Side Request Forgery).
 */

import ipaddr from "ipaddr.js";

/**
 * Checks whether an IP string is an allowed public unicast address.
 *
 * @param ip - String representing an IPv4 or IPv6 address.
 * @returns true if and only if the address is a valid public unicast IP.
 */
export function isAddressAllowed(ip: string): boolean {
  try {
    let addr = ipaddr.parse(ip);

    // If it's an IPv4-mapped IPv6 address (e.g. ::ffff:127.0.0.1), unwrap to IPv4
    if (addr.kind() === "ipv6") {
      const ipv6 = addr as ipaddr.IPv6;
      if (ipv6.isIPv4MappedAddress()) {
        addr = ipv6.toIPv4Address();
      }
    }

    // Default-deny: only "unicast" range is permitted
    return addr.range() === "unicast";
  } catch {
    // Unparsable or invalid input is rejected
    return false;
  }
}
