import net from "node:net";
import { prisma } from "../db";
import { logger } from "../logger";

const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^::1$/,
  /^fc/i,
  /^fd/i,
  /^fe80:/i,
];

function isPrivateOrLoopbackIp(ip: string): boolean {
  return PRIVATE_IP_PATTERNS.some((re) => re.test(ip));
}

interface IpGeoResult {
  city: string | null;
  region: string | null;
  country: string | null;
  lat: number | null;
  lon: number | null;
}

interface IpApiCoResponse {
  error?: boolean;
  city?: string;
  region?: string;
  country_name?: string;
  latitude?: number;
  longitude?: number;
}

// The address comes from the agent's connection, but it goes into a URL path below, so only a
// literal IPv4/IPv6 address is ever looked up (never something like "../" or "x?key=").
function isLookupableIp(ip: string): boolean {
  return net.isIP(ip) !== 0;
}

// Provider responses are shown in the console - keep only short strings.
function geoText(value: unknown): string | null {
  return typeof value === "string" && value ? value.slice(0, 100) : null;
}

async function lookupViaIpApiCo(ip: string): Promise<IpGeoResult | null> {
  if (!isLookupableIp(ip)) return null;
  const res = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return null; // includes 429 — this provider's free tier rate-limits fast
  const data = (await res.json()) as IpApiCoResponse;
  if (data.error) return null;

  return {
    city: geoText(data.city),
    region: geoText(data.region),
    country: geoText(data.country_name),
    lat: typeof data.latitude === "number" ? data.latitude : null,
    lon: typeof data.longitude === "number" ? data.longitude : null,
  };
}

interface IpApiComResponse {
  status?: string;
  city?: string;
  regionName?: string;
  country?: string;
  lat?: number;
  lon?: number;
}

// HTTP-only on the free tier (HTTPS needs a paid key) — used strictly as a fallback when
// the HTTPS-capable provider above is unavailable, not the default path. The request/
// response here is just a public IP and a city/region/country guess, not sensitive data.
async function lookupViaIpApiCom(ip: string): Promise<IpGeoResult | null> {
  if (!isLookupableIp(ip)) return null;
  const res = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return null;
  const data = (await res.json()) as IpApiComResponse;
  if (data.status !== "success") return null;

  return {
    city: geoText(data.city),
    region: geoText(data.regionName),
    country: geoText(data.country),
    lat: typeof data.lat === "number" ? data.lat : null,
    lon: typeof data.lon === "number" ? data.lon : null,
  };
}

async function lookupIpGeo(ip: string): Promise<IpGeoResult | null> {
  try {
    const primary = await lookupViaIpApiCo(ip);
    if (primary) return primary;
  } catch (err) {
    logger.warn({ err, ip }, "ipapi.co geolocation lookup failed, falling back");
  }

  try {
    return await lookupViaIpApiCom(ip);
  } catch (err) {
    logger.warn({ err, ip }, "ip-api.com geolocation lookup failed");
    return null;
  }
}

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

// Fire-and-forget from handleCheckin — must never block or fail a checkin. Only re-queries
// the external geo-IP service when the agent's IP has actually changed, or the last lookup
// is stale (24h) — this is a rate-limited third-party API, not something to hit on every
// checkin, and the 5s-polled agent list must never trigger it directly. This is purely a
// hint: the admin-entered `Agent.location` field is the authoritative source and is never
// overwritten by this.
export async function refreshIpGeoIfStale(agentId: string, ipAddress: string | null): Promise<void> {
  if (!ipAddress || !isLookupableIp(ipAddress) || isPrivateOrLoopbackIp(ipAddress)) return;

  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { ipGeoLookupIp: true, ipGeoUpdatedAt: true },
  });
  if (!agent) return;

  const isStale = !agent.ipGeoUpdatedAt || Date.now() - agent.ipGeoUpdatedAt.getTime() > STALE_AFTER_MS;
  if (agent.ipGeoLookupIp === ipAddress && !isStale) return;

  const geo = await lookupIpGeo(ipAddress);
  if (!geo) return;

  await prisma.agent.update({
    where: { id: agentId },
    data: {
      ipGeoCity: geo.city,
      ipGeoRegion: geo.region,
      ipGeoCountry: geo.country,
      ipGeoLat: geo.lat,
      ipGeoLon: geo.lon,
      ipGeoLookupIp: ipAddress,
      ipGeoUpdatedAt: new Date(),
    },
  });
}
