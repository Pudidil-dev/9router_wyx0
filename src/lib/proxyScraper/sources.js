import * as cheerio from "cheerio";

const REQUEST_TIMEOUT_MS = 15000;

const GITHUB_SOURCES = {
  proxifly: {
    label: "Proxifly",
    repo: "proxifly/free-proxy-list",
    urls: {
      http: "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/http/data.txt",
      https: "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/https/data.txt",
      socks4: "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/socks4/data.txt",
      socks5: "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/socks5/data.txt",
    },
  },
  hideip: {
    label: "HideIP.me",
    repo: "zloi-user/hideip.me",
    urls: {
      http: "https://raw.githubusercontent.com/zloi-user/hideip.me/main/http.txt",
      https: "https://raw.githubusercontent.com/zloi-user/hideip.me/main/https.txt",
      socks4: "https://raw.githubusercontent.com/zloi-user/hideip.me/main/socks4.txt",
      socks5: "https://raw.githubusercontent.com/zloi-user/hideip.me/main/socks5.txt",
    },
  },
  databay: {
    label: "Databay Labs",
    repo: "databay-labs/free-proxy-list",
    urls: {
      http: "https://raw.githubusercontent.com/databay-labs/free-proxy-list/master/http.txt",
      socks4: "https://raw.githubusercontent.com/databay-labs/free-proxy-list/master/socks4.txt",
      socks5: "https://raw.githubusercontent.com/databay-labs/free-proxy-list/master/socks5.txt",
    },
  },
  zaeem: {
    label: "Zaeem20",
    repo: "Zaeem20/FREE_PROXIES_LIST",
    urls: {
      http: "https://raw.githubusercontent.com/Zaeem20/FREE_PROXIES_LIST/master/http.txt",
      https: "https://raw.githubusercontent.com/Zaeem20/FREE_PROXIES_LIST/master/https.txt",
      socks4: "https://raw.githubusercontent.com/Zaeem20/FREE_PROXIES_LIST/master/socks4.txt",
      socks5: "https://raw.githubusercontent.com/Zaeem20/FREE_PROXIES_LIST/master/socks5.txt",
    },
  },
  vakhov: {
    label: "Vakhov Fresh Proxy",
    repo: "vakhov/fresh-proxy-list",
    urls: {
      http: "https://raw.githubusercontent.com/vakhov/fresh-proxy-list/master/http.txt",
      https: "https://raw.githubusercontent.com/vakhov/fresh-proxy-list/master/https.txt",
      socks4: "https://raw.githubusercontent.com/vakhov/fresh-proxy-list/master/socks4.txt",
      socks5: "https://raw.githubusercontent.com/vakhov/fresh-proxy-list/master/socks5.txt",
    },
  },
  dpangestuw: {
    label: "Dpangestuw",
    repo: "dpangestuw/Free-Proxy",
    urls: {
      http: "https://raw.githubusercontent.com/dpangestuw/Free-Proxy/main/http_proxies.txt",
      socks4: "https://raw.githubusercontent.com/dpangestuw/Free-Proxy/main/socks4_proxies.txt",
      socks5: "https://raw.githubusercontent.com/dpangestuw/Free-Proxy/main/socks5_proxies.txt",
    },
  },
  elliottophellia: {
    label: "Elliottophellia",
    repo: "elliottophellia/proxylist",
    urls: {
      http: "https://raw.githubusercontent.com/elliottophellia/proxylist/master/results/http/global/http_checked.txt",
      socks4: "https://raw.githubusercontent.com/elliottophellia/proxylist/master/results/socks4/global/socks4_checked.txt",
      socks5: "https://raw.githubusercontent.com/elliottophellia/proxylist/master/results/socks5/global/socks5_checked.txt",
    },
  },
};

const FREE_PROXY_BASE_URL = "https://free-proxy-list.net/en";
const FREE_PROXY_TARGETS = {
  us: { url: `${FREE_PROXY_BASE_URL}/us-proxy.html`, label: "US Proxy" },
  uk: { url: `${FREE_PROXY_BASE_URL}/uk-proxy.html`, label: "UK Proxy" },
  ssl: { url: `${FREE_PROXY_BASE_URL}/ssl-proxy.html`, label: "SSL Proxy" },
  anonymous: { url: `${FREE_PROXY_BASE_URL}/anonymous-proxy.html`, label: "Anonymous Proxy" },
  google: { url: `${FREE_PROXY_BASE_URL}/google-proxy.html`, label: "Google Proxy" },
  socks: { url: `${FREE_PROXY_BASE_URL}/socks-proxy.html`, label: "Socks Proxy" },
  new: { url: `${FREE_PROXY_BASE_URL}/`, label: "New Proxy" },
};

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) proxy-scraper/1.0",
        Accept: "text/html,text/plain,*/*",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function parseProxyText(text, source) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(line))
    .map((proxy) => ({ ...source, proxy }));
}

export async function scrapeGithubProxies(protocols = ["http", "https"]) {
  const candidates = [];
  const errors = [];
  const tasks = [];

  for (const [sourceKey, source] of Object.entries(GITHUB_SOURCES)) {
    for (const protocol of protocols) {
      const url = source.urls[protocol];
      if (!url) continue;
      tasks.push((async () => {
        try {
          const text = await fetchText(url);
          candidates.push(...parseProxyText(text, {
            sourceId: `github:${sourceKey}`,
            sourceLabel: source.label,
            sourceUrl: url,
            protocol,
          }));
        } catch (error) {
          errors.push({ sourceId: `github:${sourceKey}`, protocol, error: error.message });
        }
      })());
    }
  }

  await Promise.all(tasks);
  return { candidates, errors };
}

export async function scrapeFreeProxyList(targetKey = "us") {
  const target = FREE_PROXY_TARGETS[targetKey] || FREE_PROXY_TARGETS.us;
  const html = await fetchText(target.url);
  const $ = cheerio.load(html);
  const table = $("table.table-striped.table-bordered").first();
  const candidates = [];

  if (table.length > 0) {
    const headers = [];
    table.find("thead tr th").each((_, th) => headers.push($(th).text().trim().toLowerCase()));

    table.find("tbody tr").each((_, tr) => {
      const cells = [];
      $(tr).find("td").each((__, td) => cells.push($(td).text().trim()));
      if (cells.length < 2) return;

      const row = {};
      headers.forEach((header, index) => {
        if (index < cells.length) row[header] = cells[index];
      });

      const ip = row["ip address"] || row.ip || cells[0];
      const port = row.port || cells[1];
      if (!ip || !port) return;

      candidates.push({
        sourceId: `free-proxy-list:${targetKey}`,
        sourceLabel: target.label,
        sourceUrl: target.url,
        protocol: "http",
        ip,
        port,
        code: row.code || cells[2] || "",
        country: row.country || cells[3] || "",
        anonymity: row.anonymity || cells[4] || "",
        google: String(row.google || cells[5] || "").toLowerCase() === "yes",
        https: String(row.https || cells[6] || "").toLowerCase() === "yes",
      });
    });
  }

  $("textarea.form-control").first().text().trim().split("\n")
    .map((line) => line.trim())
    .filter((line) => /^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(line))
    .forEach((proxy) => candidates.push({
      sourceId: `free-proxy-list:${targetKey}`,
      sourceLabel: target.label,
      sourceUrl: target.url,
      protocol: "http",
      proxy,
    }));

  return { candidates, errors: [] };
}

export async function scrapeProxySources({ sourceIds = ["github", "free-proxy-list"], protocols = ["http", "https"], target = "us" } = {}) {
  const requested = sourceIds.includes("all") ? ["github", "free-proxy-list"] : sourceIds;
  const results = await Promise.all(requested.map(async (sourceId) => {
    try {
      if (sourceId === "github") return await scrapeGithubProxies(protocols);
      if (sourceId === "free-proxy-list") return await scrapeFreeProxyList(target);
      return { candidates: [], errors: [{ sourceId, error: "Unknown source" }] };
    } catch (error) {
      return { candidates: [], errors: [{ sourceId, error: error.message }] };
    }
  }));

  return results.reduce((acc, result) => {
    acc.candidates.push(...result.candidates);
    acc.errors.push(...result.errors);
    return acc;
  }, { candidates: [], errors: [] });
}

export function getProxyScraperSources() {
  return [
    { id: "github", label: "GitHub proxy lists" },
    { id: "free-proxy-list", label: "Free Proxy List" },
  ];
}
