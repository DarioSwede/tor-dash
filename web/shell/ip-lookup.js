// On-demand IP lookup (reverse DNS + geo/ASN) for rows in the access log
// — the pragmatic middle ground for "nslookup mm against the site":
// GitHub Pages exposes no real server/CDN traffic logs at all (a
// platform limit, not something code can work around), so this enriches
// an IP already captured in access_log only when asked, rather than
// pretending to be live traffic monitoring.
//
// Reverse DNS uses Google's public DNS-over-HTTPS JSON API (browser-
// fetchable, no key) — IPv4 only; constructing the IPv6 PTR name
// (nibble-reversed ip6.arpa) isn't implemented since those records are
// rarely populated anyway. Geo/ASN uses ipapi.co looked up by IP (same
// service network.js already uses for the current visitor's own IP,
// here passed an arbitrary address instead).

async function reverseDns(ip) {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return null;
  const name = `${ip.split(".").reverse().join(".")}.in-addr.arpa`;
  try {
    const res = await fetch(`https://dns.google/resolve?name=${name}&type=PTR`);
    if (!res.ok) return null;
    const data = await res.json();
    const record = data?.Answer?.find((a) => a.type === 12); // 12 = PTR
    return record ? record.data.replace(/\.$/, "") : null;
  } catch {
    return null;
  }
}

async function geoInfo(ip) {
  try {
    const res = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.error) return null;
    return {
      org: data.org || null,
      asn: data.asn || null,
      city: data.city || null,
      country: data.country_name || null,
    };
  } catch {
    return null;
  }
}

export async function lookupIp(ip) {
  const [hostname, geo] = await Promise.all([reverseDns(ip), geoInfo(ip)]);
  return { ip, hostname, org: null, asn: null, city: null, country: null, ...geo };
}
