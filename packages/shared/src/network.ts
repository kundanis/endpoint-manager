// Picks the network adapter an agent reports as the endpoint's IP and MAC address.
//
// os.networkInterfaces() lists adapters in whatever order the OS gives, and VPN / virtual
// adapters (Tailscale, WireGuard, Hyper-V/WSL switches, Docker bridges, VMware, ...) often
// come first. A VPN adapter has no hardware MAC (00:00:00:00:00:00), so taking the first
// adapter reported no MAC and a VPN IP instead of the machine's real LAN address.
//
// Preference: a physical-looking adapter with a real MAC, then any adapter with a real MAC,
// then any adapter at all (IP only). IPv4, non-loopback only. Pure - takes the
// os.networkInterfaces() result so it can be tested anywhere.

export interface NetworkInterfaceLike {
  address: string;
  family: string | number;
  mac: string;
  internal: boolean;
}

const VIRTUAL_ADAPTER =
  /^(vethernet|veth|virbr|vmnet|vboxnet|docker|br-|bridge|cni|flannel|cali|tun|tap|utun|wg|zt|tailscale|awdl|llw|ham|npcap|loopback)|virtual|vmware|hyper-v|vpn|tailscale|wireguard|zerotier|openvpn|fortinet|forticlient|anyconnect|globalprotect|wintun/i;

const NO_MAC = "00:00:00:00:00:00";

const hasRealMac = (mac: string) => Boolean(mac) && mac !== NO_MAC;
// Link-local (no DHCP lease) is never the useful address.
const isLinkLocal = (address: string) => address.startsWith("169.254.");

export function selectPrimaryNetworkInterface(
  interfaces: Record<string, NetworkInterfaceLike[] | undefined>,
): { ipAddress: string | null; macAddress: string | null } {
  const candidates: { name: string; iface: NetworkInterfaceLike }[] = [];
  for (const [name, list] of Object.entries(interfaces)) {
    for (const iface of list ?? []) {
      const isV4 = iface.family === "IPv4" || iface.family === 4;
      if (isV4 && !iface.internal && !isLinkLocal(iface.address)) candidates.push({ name, iface });
    }
  }

  const pick =
    candidates.find((c) => hasRealMac(c.iface.mac) && !VIRTUAL_ADAPTER.test(c.name)) ??
    candidates.find((c) => hasRealMac(c.iface.mac)) ??
    candidates[0];

  if (!pick) return { ipAddress: null, macAddress: null };
  return { ipAddress: pick.iface.address, macAddress: hasRealMac(pick.iface.mac) ? pick.iface.mac : null };
}
