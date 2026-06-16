/**
 * Unit tests for gemini-web cookie parsing and SAPISIDHASH computation.
 *
 * Covers:
 *  - parseCookieString: tolerant header parsing (bare value, "Cookie: ..." prefix, quoted values, whitespace)
 *  - Required-cookie validation: rejects when any of SID/HSID/SSID/APISID/SAPISID/__Secure-1PSID missing
 *  - makeSapisidHash: stable shape "SAPISIDHASH ${ts}_${sha1hex}"
 *  - 200/302/401/403 response handling on the bootstrap probe
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import nodeCrypto from "node:crypto";

const REQUIRED_COOKIES = ["SID", "HSID", "SSID", "APISID", "SAPISID", "__Secure-1PSID"];

// Replicates parseCookieString() in src/app/api/providers/gemini-web/cookie/route.js
function parseCookieString(raw) {
  const out = {};
  if (typeof raw !== "string") return out;
  const trimmed = raw.replace(/^\s*Cookie\s*:\s*/i, "").trim();
  for (const pair of trimmed.split(/;\s*/)) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const key = pair.slice(0, eq).trim();
    let value = pair.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (key) out[key] = value;
  }
  return out;
}

// Replicates makeSapisidHash() in the gemini-web executor + cookie route
function makeSapisidHash(sapisid, origin = "https://gemini.google.com") {
  const ts = Math.floor(Date.now() / 1000);
  const hash = nodeCrypto.createHash("sha1").update(`${ts} ${sapisid} ${origin}`).digest("hex");
  return { full: `SAPISIDHASH ${ts}_${hash}`, ts, hash };
}

function validateCookies(parsed) {
  const missing = REQUIRED_COOKIES.filter((k) => !parsed[k]);
  return { valid: missing.length === 0, missing };
}

const FULL_HEADER =
  "SID=abc; HSID=def; SSID=ghi; APISID=jkl; SAPISID=mno; __Secure-1PSID=pqr; __Secure-1PSIDTS=stu; NID=999";

describe("parseCookieString", () => {
  it("parses a clean Cookie header", () => {
    const out = parseCookieString(FULL_HEADER);
    expect(out.SID).toBe("abc");
    expect(out.HSID).toBe("def");
    expect(out.SAPISID).toBe("mno");
    expect(out["__Secure-1PSID"]).toBe("pqr");
    expect(out["__Secure-1PSIDTS"]).toBe("stu");
  });

  it("strips a leading 'Cookie:' label if user pasted the full header line", () => {
    const out = parseCookieString(`Cookie: ${FULL_HEADER}`);
    expect(out.SID).toBe("abc");
    expect(out["__Secure-1PSID"]).toBe("pqr");
  });

  it("tolerates extra whitespace and case-insensitive 'Cookie:' label", () => {
    const out = parseCookieString(`  cookie:    ${FULL_HEADER}   `);
    expect(out.APISID).toBe("jkl");
  });

  it("strips surrounding double quotes from values", () => {
    const out = parseCookieString('SID="abc"; HSID="def"');
    expect(out.SID).toBe("abc");
    expect(out.HSID).toBe("def");
  });

  it("ignores empty pairs and pairs with no '='", () => {
    const out = parseCookieString("SID=abc; ; junk; HSID=def;");
    expect(out.SID).toBe("abc");
    expect(out.HSID).toBe("def");
    expect(Object.keys(out)).toHaveLength(2);
  });

  it("returns empty object for non-string input", () => {
    expect(parseCookieString(null)).toEqual({});
    expect(parseCookieString(undefined)).toEqual({});
    expect(parseCookieString(42)).toEqual({});
  });

  it("preserves '=' inside cookie values", () => {
    const out = parseCookieString("SID=a=b=c; HSID=plain");
    expect(out.SID).toBe("a=b=c");
    expect(out.HSID).toBe("plain");
  });
});

describe("validateCookies (required-cookie check)", () => {
  it("accepts a header with all 6 required cookies", () => {
    const result = validateCookies(parseCookieString(FULL_HEADER));
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("rejects when SAPISID is missing and reports it", () => {
    const partial = "SID=abc; HSID=def; SSID=ghi; APISID=jkl; __Secure-1PSID=pqr";
    const result = validateCookies(parseCookieString(partial));
    expect(result.valid).toBe(false);
    expect(result.missing).toEqual(["SAPISID"]);
  });

  it("reports multiple missing cookies", () => {
    const partial = "SID=abc; APISID=jkl";
    const result = validateCookies(parseCookieString(partial));
    expect(result.valid).toBe(false);
    expect(result.missing).toEqual(["HSID", "SSID", "SAPISID", "__Secure-1PSID"]);
  });

  it("rejects an empty cookie string and reports all 6", () => {
    const result = validateCookies(parseCookieString(""));
    expect(result.valid).toBe(false);
    expect(result.missing).toEqual(REQUIRED_COOKIES);
  });
});

describe("makeSapisidHash", () => {
  it("returns the canonical SAPISIDHASH shape", () => {
    const { full, ts, hash } = makeSapisidHash("test-sapisid");
    expect(full).toBe(`SAPISIDHASH ${ts}_${hash}`);
    expect(hash).toMatch(/^[0-9a-f]{40}$/);
  });

  it("hashes 'ts SAPISID origin' with SHA-1", () => {
    const sapisid = "fixed";
    const origin = "https://gemini.google.com";
    const { ts, hash } = makeSapisidHash(sapisid, origin);
    const expected = nodeCrypto.createHash("sha1").update(`${ts} ${sapisid} ${origin}`).digest("hex");
    expect(hash).toBe(expected);
  });

  it("changes when SAPISID changes", () => {
    const a = makeSapisidHash("alpha").hash;
    const b = makeSapisidHash("beta").hash;
    expect(a).not.toBe(b);
  });
});

describe("session probe response handling", () => {
  const originalFetch = global.fetch;
  beforeEach(() => { global.fetch = vi.fn(); });
  afterEach(() => { global.fetch = originalFetch; });

  // Mirrors the probe outcome semantics in the cookie route:
  //   200 → ok
  //   302/401/403 → expired/invalid
  //   other → unexpected
  async function probe(status) {
    const res = await fetch("https://gemini.google.com/app", {
      headers: { Cookie: "stub", Authorization: "SAPISIDHASH 0_0" },
    });
    if (res.status === 200) return { ok: true };
    if (res.status === 302 || res.status === 401 || res.status === 403) {
      return { ok: false, error: "Session expired or cookies invalid" };
    }
    return { ok: false, error: `Unexpected upstream status: ${res.status}` };
  }

  it("treats HTTP 200 as authenticated", async () => {
    global.fetch.mockResolvedValueOnce({ status: 200, text: async () => "<html>SNlM0e</html>" });
    expect(await probe()).toEqual({ ok: true });
  });

  it("treats 302 redirect (sign-in) as session expired", async () => {
    global.fetch.mockResolvedValueOnce({ status: 302 });
    const r = await probe();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/expired|invalid/i);
  });

  it("treats 401 as session expired", async () => {
    global.fetch.mockResolvedValueOnce({ status: 401 });
    expect((await probe()).ok).toBe(false);
  });

  it("treats 403 as session expired", async () => {
    global.fetch.mockResolvedValueOnce({ status: 403 });
    expect((await probe()).ok).toBe(false);
  });

  it("flags unexpected statuses (e.g. 500) without claiming the session is dead", async () => {
    global.fetch.mockResolvedValueOnce({ status: 500 });
    const r = await probe();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Unexpected upstream status: 500/);
  });
});

describe("XSRF token scraping", () => {
  it("extracts SNlM0e token from HTML body when present", () => {
    const html = '<script>"SNlM0e":"AbCdEfG_xyz=="</script>';
    const m = html.match(/"SNlM0e":"([^"]+)"/);
    expect(m).not.toBeNull();
    expect(m[1]).toBe("AbCdEfG_xyz==");
  });

  it("returns null when SNlM0e absent (200 still treated as ok)", () => {
    const html = "<html>no token here</html>";
    const m = html.match(/"SNlM0e":"([^"]+)"/);
    expect(m).toBeNull();
  });
});

// ----- cURL parsing -----
// Replicates extractCookieFromCurl + looksLikeCurl + extractCookieAny in the route.

function looksLikeCurl(input) {
  if (typeof input !== "string") return false;
  const head = input.replace(/^[\s\\]+/, "").slice(0, 16).toLowerCase();
  if (head.startsWith("curl ") || head.startsWith("curl.exe ")) return true;
  return /(?:^|\s)-(?:H|b|-cookie|-header)\s+['"]/.test(input);
}

function extractCookieFromCurl(curlText) {
  if (typeof curlText !== "string") return null;
  let collapsed = curlText
    .replace(/\\\r?\n/g, " ")
    .replace(/`\r?\n/g, " ")
    .replace(/\^\r?\n/g, " ");

  // Windows cmd-format normalization
  collapsed = collapsed
    .replace(/\^"/g, '"')
    .replace(/\^\^/g, "^")
    .replace(/\^([&|<>%])/g, "$1");

  collapsed = collapsed.replace(/\s+/g, " ");

  const headerPatterns = [
    /(?:-H|--header)\s+'Cookie:\s*([^']+)'/i,
    /(?:-H|--header)\s+"Cookie:\s*((?:[^"\\]|\\.)+)"/i,
    /(?:-H|--header)\s+\$'Cookie:\s*((?:[^']|\\')+)'/i,
  ];
  for (const re of headerPatterns) {
    const m = collapsed.match(re);
    if (m && m[1]) return m[1].replace(/\\"/g, '"').trim();
  }

  const cookieFlagPatterns = [
    /(?:^|\s)(?:-b|--cookie)\s+'([^']+)'/,
    /(?:^|\s)(?:-b|--cookie)\s+"((?:[^"\\]|\\.)+)"/,
  ];
  for (const re of cookieFlagPatterns) {
    const m = collapsed.match(re);
    if (m && m[1]) return m[1].replace(/\\"/g, '"').trim();
  }
  return null;
}

function extractCookieAny(input) {
  if (typeof input !== "string" || !input.trim()) return null;
  if (looksLikeCurl(input)) {
    const cookie = extractCookieFromCurl(input);
    if (cookie) return { cookieString: cookie, source: "curl" };
    return null;
  }
  return { cookieString: input, source: "raw" };
}

describe("looksLikeCurl", () => {
  it("recognizes a curl command at the start of input", () => {
    expect(looksLikeCurl("curl 'https://gemini.google.com/...'")).toBe(true);
  });

  it("recognizes Windows curl.exe", () => {
    expect(looksLikeCurl("curl.exe 'https://gemini.google.com/...'")).toBe(true);
  });

  it("tolerates leading backslash continuation when user pasted a wrapped command", () => {
    expect(looksLikeCurl("\\\ncurl 'https://...'")).toBe(true);
  });

  it("returns false for a raw cookie string", () => {
    expect(looksLikeCurl("SID=abc; HSID=def")).toBe(false);
  });

  it("returns false for empty / non-string input", () => {
    expect(looksLikeCurl("")).toBe(false);
    expect(looksLikeCurl(null)).toBe(false);
  });
});

describe("extractCookieFromCurl — Chrome/Linux bash format", () => {
  it("extracts Cookie from -H 'Cookie: ...' (single-quoted)", () => {
    const curl = `curl 'https://gemini.google.com/_/BardChatUi/data/...' \\
      -H 'authority: gemini.google.com' \\
      -H 'Cookie: SID=abc; HSID=def; SSID=ghi; APISID=jkl; SAPISID=mno; __Secure-1PSID=pqr' \\
      -H 'Origin: https://gemini.google.com' \\
      --data-raw 'f.req=...'`;
    expect(extractCookieFromCurl(curl)).toBe(
      "SID=abc; HSID=def; SSID=ghi; APISID=jkl; SAPISID=mno; __Secure-1PSID=pqr"
    );
  });

  it("extracts Cookie from --header 'Cookie: ...'", () => {
    const curl = `curl 'https://gemini.google.com/' --header 'Cookie: SID=abc; HSID=def'`;
    expect(extractCookieFromCurl(curl)).toBe("SID=abc; HSID=def");
  });
});

describe("extractCookieFromCurl — Windows powershell / cmd formats", () => {
  it("extracts Cookie from -H \"Cookie: ...\" (double-quoted)", () => {
    const curl = `curl.exe "https://gemini.google.com/" ^
      -H "Cookie: SID=abc; HSID=def; SAPISID=mno"`;
    expect(extractCookieFromCurl(curl)).toBe("SID=abc; HSID=def; SAPISID=mno");
  });

  it("collapses caret continuations (cmd.exe style)", () => {
    const curl = `curl "https://gemini.google.com/" ^\r\n  -H "Cookie: SID=abc"`;
    expect(extractCookieFromCurl(curl)).toBe("SID=abc");
  });

  it("collapses backtick continuations (powershell style)", () => {
    const curl = "curl 'https://gemini.google.com/' `\n  -H 'Cookie: SID=abc'";
    expect(extractCookieFromCurl(curl)).toBe("SID=abc");
  });

  // Chrome's actual "Copy as cURL (cmd)" output wraps every quoted argument
  // with caret-quotes (^"..^") and emits the header name in lowercase.
  it("handles real Chrome 'Copy as cURL (cmd)' caret-quoted output", () => {
    const curl = `curl ^"https://gemini.google.com/_/BardChatUi/data/StreamGenerate^" ^
  -H ^"accept: */*^" ^
  -H ^"cookie: SID=abc; HSID=def; SSID=ghi; APISID=jkl; SAPISID=mno; __Secure-1PSID=pqr^" ^
  -H ^"user-agent: Mozilla/5.0^" ^
  --data-raw ^"f.req=...^"`;
    expect(extractCookieFromCurl(curl)).toBe(
      "SID=abc; HSID=def; SSID=ghi; APISID=jkl; SAPISID=mno; __Secure-1PSID=pqr"
    );
  });

  it("handles cmd format with caret-escaped special chars (^&, ^|) inside the header", () => {
    // & is rare in cookie values but ensures the un-escaping doesn't corrupt content
    const curl = `curl ^"https://gemini.google.com/^" ^
  -H ^"cookie: SID=abc^&def; HSID=ghi^"`;
    expect(extractCookieFromCurl(curl)).toBe("SID=abc&def; HSID=ghi");
  });

  it("handles cmd format with doubled carets (^^) for literal caret in value", () => {
    const curl = `curl ^"https://gemini.google.com/^" -H ^"cookie: SID=ab^^cd; HSID=def^"`;
    expect(extractCookieFromCurl(curl)).toBe("SID=ab^cd; HSID=def");
  });

  it("handles cmd format with caret continuations between flags", () => {
    const curl = `curl ^"https://gemini.google.com/^" ^\r\n  -H ^"accept: */*^" ^\r\n  -H ^"cookie: SID=abc; HSID=def^"`;
    expect(extractCookieFromCurl(curl)).toBe("SID=abc; HSID=def");
  });
});

describe("extractCookieFromCurl — -b / --cookie flag", () => {
  it("extracts cookies from -b 'SID=...; ...'", () => {
    const curl = `curl -b 'SID=abc; HSID=def' https://gemini.google.com/`;
    expect(extractCookieFromCurl(curl)).toBe("SID=abc; HSID=def");
  });

  it("extracts cookies from --cookie \"SID=...; ...\"", () => {
    const curl = `curl --cookie "SID=abc; HSID=def" https://gemini.google.com/`;
    expect(extractCookieFromCurl(curl)).toBe("SID=abc; HSID=def");
  });
});

describe("extractCookieFromCurl — failure modes", () => {
  it("returns null when no Cookie header is present", () => {
    const curl = `curl 'https://gemini.google.com/' -H 'Accept: */*'`;
    expect(extractCookieFromCurl(curl)).toBe(null);
  });

  it("returns null for empty input", () => {
    expect(extractCookieFromCurl("")).toBe(null);
    expect(extractCookieFromCurl(null)).toBe(null);
  });
});

describe("extractCookieAny — smart router", () => {
  it("routes a raw cookie string through unchanged", () => {
    const out = extractCookieAny("SID=abc; HSID=def");
    expect(out.source).toBe("raw");
    expect(out.cookieString).toBe("SID=abc; HSID=def");
  });

  it("routes a cURL command through the cURL parser", () => {
    const curl = `curl 'https://gemini.google.com/' -H 'Cookie: SID=abc; HSID=def'`;
    const out = extractCookieAny(curl);
    expect(out.source).toBe("curl");
    expect(out.cookieString).toBe("SID=abc; HSID=def");
  });

  it("returns null when cURL is detected but no Cookie header is found", () => {
    expect(extractCookieAny(`curl 'https://gemini.google.com/' -H 'X-Foo: bar'`)).toBe(null);
  });

  it("returns null for empty input", () => {
    expect(extractCookieAny("")).toBe(null);
    expect(extractCookieAny("   ")).toBe(null);
  });

  it("end-to-end: a real Chrome-style cURL paste yields all 6 required cookies", () => {
    const curl = `curl 'https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate' \\
  -H 'authority: gemini.google.com' \\
  -H 'accept: */*' \\
  -H 'Cookie: SID=abc; HSID=def; SSID=ghi; APISID=jkl; SAPISID=mno; __Secure-1PSID=pqr; __Secure-1PSIDTS=stu; NID=999' \\
  --data-raw 'f.req=...'`;
    const out = extractCookieAny(curl);
    expect(out.source).toBe("curl");
    const parsed = parseCookieString(out.cookieString);
    expect(validateCookies(parsed).valid).toBe(true);
    expect(parsed["__Secure-1PSID"]).toBe("pqr");
    expect(parsed["__Secure-1PSIDTS"]).toBe("stu");
  });
});
