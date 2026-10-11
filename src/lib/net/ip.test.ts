import { describe, it, expect } from "vitest";
import { isAddressAllowed } from "./ip";

describe("isAddressAllowed", () => {
  it("allows public IPv4 unicast addresses", () => {
    expect(isAddressAllowed("8.8.8.8")).toBe(true);
    expect(isAddressAllowed("1.1.1.1")).toBe(true);
  });

  it("blocks private, loopback, link-local, and reserved IPv4 addresses", () => {
    expect(isAddressAllowed("127.0.0.1")).toBe(false);
    expect(isAddressAllowed("10.0.0.1")).toBe(false);
    expect(isAddressAllowed("172.16.0.1")).toBe(false);
    expect(isAddressAllowed("192.168.1.1")).toBe(false);
    expect(isAddressAllowed("169.254.169.254")).toBe(false);
    expect(isAddressAllowed("100.64.0.1")).toBe(false);
    expect(isAddressAllowed("0.0.0.0")).toBe(false);
    expect(isAddressAllowed("224.0.0.1")).toBe(false);
    expect(isAddressAllowed("255.255.255.255")).toBe(false);
    expect(isAddressAllowed("198.18.0.1")).toBe(false);
    expect(isAddressAllowed("192.0.2.1")).toBe(false);
  });

  it("blocks special, loopback, and local IPv6 addresses", () => {
    expect(isAddressAllowed("::1")).toBe(false);
    expect(isAddressAllowed("::")).toBe(false);
    expect(isAddressAllowed("fe80::1")).toBe(false);
    expect(isAddressAllowed("fc00::1")).toBe(false);
    expect(isAddressAllowed("::ffff:127.0.0.1")).toBe(false);
    expect(isAddressAllowed("::ffff:10.0.0.1")).toBe(false);
    expect(isAddressAllowed("64:ff9b::7f00:1")).toBe(false);
  });

  it("allows public IPv6 unicast addresses", () => {
    expect(isAddressAllowed("2001:4860:4860::8888")).toBe(true);
  });

  it("blocks garbage/unparsable input", () => {
    expect(isAddressAllowed("garbage")).toBe(false);
  });
});
