// selectPrimaryNetworkInterface (in @em/shared, used by all three agents) against adapter
// layouts seen on real machines. Run with: npm test -w @em/agent-macos
import { test } from "node:test";
import assert from "node:assert/strict";
import { selectPrimaryNetworkInterface } from "@em/shared";

const v4 = (address: string, mac: string, internal = false) => ({ address, family: "IPv4", mac, internal });
const NO_MAC = "00:00:00:00:00:00";

test("Windows: skips Tailscale listed first and Hyper-V switches", () => {
  const result = selectPrimaryNetworkInterface({
    Tailscale: [v4("100.97.166.41", NO_MAC)],
    "vEthernet (Default Switch)": [v4("172.19.64.1", "00:15:5d:dc:7f:47")],
    "Wi-Fi": [v4("10.10.6.210", "00:93:37:fe:86:ca")],
    "Loopback Pseudo-Interface 1": [v4("127.0.0.1", NO_MAC, true)],
  });
  assert.deepEqual(result, { ipAddress: "10.10.6.210", macAddress: "00:93:37:fe:86:ca" });
});

test("Linux: skips docker0 and tailscale0", () => {
  const result = selectPrimaryNetworkInterface({
    lo: [v4("127.0.0.1", NO_MAC, true)],
    docker0: [v4("172.17.0.1", "02:42:ac:11:00:01")],
    tailscale0: [v4("100.64.0.5", NO_MAC)],
    ens160: [v4("192.168.1.20", "00:50:56:aa:bb:cc")],
  });
  assert.deepEqual(result, { ipAddress: "192.168.1.20", macAddress: "00:50:56:aa:bb:cc" });
});

test("macOS: skips utun and link-local", () => {
  const result = selectPrimaryNetworkInterface({
    lo0: [v4("127.0.0.1", NO_MAC, true)],
    en5: [v4("169.254.10.2", "ac:de:48:00:11:22")],
    utun4: [v4("10.8.0.2", NO_MAC)],
    en0: [{ address: "fe80::1", family: "IPv6", mac: "3c:22:fb:01:02:03", internal: false }, v4("192.168.0.14", "3c:22:fb:01:02:03")],
  });
  assert.deepEqual(result, { ipAddress: "192.168.0.14", macAddress: "3c:22:fb:01:02:03" });
});

test("only a VPN adapter: report its IP without a MAC", () => {
  assert.deepEqual(selectPrimaryNetworkInterface({ Tailscale: [v4("100.97.166.41", NO_MAC)] }), {
    ipAddress: "100.97.166.41",
    macAddress: null,
  });
});

test("only virtual adapters with MACs: still report one", () => {
  assert.deepEqual(selectPrimaryNetworkInterface({ "vEthernet (WSL)": [v4("172.28.112.1", "00:15:5d:17:ad:02")] }), {
    ipAddress: "172.28.112.1",
    macAddress: "00:15:5d:17:ad:02",
  });
});

test("no usable adapter", () => {
  assert.deepEqual(selectPrimaryNetworkInterface({ lo: [v4("127.0.0.1", NO_MAC, true)] }), { ipAddress: null, macAddress: null });
});
