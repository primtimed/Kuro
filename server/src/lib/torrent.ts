// nyaa.si torrent search, used to detect which episodes have English dub releases.

export interface NyaaResult {
  title: string;
  magnet: string; // may be a magnet URI or a .torrent URL
  seeders: number;
}

export async function searchNyaa(query: string): Promise<NyaaResult[]> {
  const url = `https://nyaa.si/?page=rss&q=${encodeURIComponent(query)}&c=1_2&f=0`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`nyaa.si ${res.status}`);
  const xml = await res.text();

  const out: NyaaResult[] = [];
  const rx = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = rx.exec(xml)) !== null) {
    const item = m[1];
    const title =
      item.match(/<title><!\[CDATA\[([^\]]+)\]\]>/)?.[1] ??
      item.match(/<title>([^<]+)<\/title>/)?.[1] ?? "";
    // Prefer the .torrent download link (has full tracker list) over a constructed magnet
    const torrentUrl = item.match(/<link>(https?:\/\/nyaa\.si\/download\/[^<]+)<\/link>/)?.[1] ?? "";
    const magnet = torrentUrl || (item.match(/magnet:\?[^<"&\s]+/)?.[0] ?? "");
    const seeders = parseInt(item.match(/<nyaa:seeders>(\d+)<\/nyaa:seeders>/)?.[1] ?? "0", 10);
    if (title && magnet) out.push({ title, magnet, seeders });
  }
  return out;
}
