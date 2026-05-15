import net from "node:net";
import tls from "node:tls";

const DEFAULT_FETCH_TIMEOUT_MS = 120_000;
const MAX_REDIRECTS = 5;
const MAX_HEADER_BYTES = 64 * 1024;

function splitProxyList(value) {
  return String(value || "")
    .split(/[,\s;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeProxyUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let proxy;
  try {
    proxy = new URL(withProtocol);
  } catch {
    return null;
  }

  if (!["http:", "https:"].includes(proxy.protocol)) return null;
  if (!proxy.hostname) return null;
  if (!proxy.port) {
    proxy.port = proxy.protocol === "https:" ? "443" : "80";
  }
  proxy.hash = "";
  return proxy.href;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function noProxyMatches(targetUrl, noProxyValue) {
  if (!noProxyValue) return false;
  let target;
  try {
    target = new URL(targetUrl);
  } catch {
    return false;
  }

  const host = target.hostname.toLowerCase();
  const port = target.port || (target.protocol === "https:" ? "443" : "80");
  return String(noProxyValue)
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) => {
      if (entry === "*") return true;
      const [patternHost, patternPort] = entry.includes(":") ? entry.split(":") : [entry, ""];
      if (patternPort && patternPort !== port) return false;
      if (patternHost.startsWith(".")) return host.endsWith(patternHost);
      return host === patternHost || host.endsWith(`.${patternHost}`);
    });
}

function getEnvValue(env, names) {
  for (const name of names) {
    if (env[name]) return env[name];
  }
  return "";
}

function getExplicitProxyUrls(env) {
  return splitProxyList(env.SKILL_EVAL_FETCH_PROXY).map(normalizeProxyUrl).filter(Boolean);
}

export function getConfiguredFetchProxies(targetUrl, env = process.env) {
  let targetProtocol = "";
  try {
    targetProtocol = new URL(targetUrl).protocol;
  } catch {
    targetProtocol = "";
  }

  const explicitProxies = getExplicitProxyUrls(env);
  const noProxyValue = getEnvValue(env, ["NO_PROXY", "no_proxy"]);
  if (noProxyMatches(targetUrl, noProxyValue)) {
    return unique(explicitProxies);
  }

  const envProxyNames =
    targetProtocol === "http:"
      ? ["HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"]
      : ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"];
  const envProxies = envProxyNames.flatMap((name) => splitProxyList(env[name])).map(normalizeProxyUrl).filter(Boolean);
  return unique([...explicitProxies, ...envProxies]);
}

export function getFetchTimeoutMs(env = process.env, override) {
  const value = override ?? env.SKILL_EVAL_FETCH_TIMEOUT_MS;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_FETCH_TIMEOUT_MS;
  return Math.max(1_000, Math.floor(parsed));
}

function hasExplicitProxy(env) {
  return getExplicitProxyUrls(env).length > 0;
}

function headersToMap(headers) {
  const map = new Map();
  if (typeof headers?.forEach === "function") {
    headers.forEach((value, key) => {
      map.set(String(key).toLowerCase(), String(value));
    });
    return map;
  }

  for (const [key, value] of Object.entries(headers || {})) {
    map.set(String(key).toLowerCase(), String(value));
  }
  return map;
}

function assertSize(buffer, maxBytes) {
  if (buffer.length > maxBytes) {
    throw new Error(`Image exceeds ${maxBytes} bytes`);
  }
}

function summarizeFetchError(error) {
  const parts = [];
  if (error?.name && error.name !== "Error") parts.push(error.name);
  if (error?.message) parts.push(error.message);

  const cause = error?.cause;
  if (cause?.code) parts.push(cause.code);
  if (cause?.address) parts.push(`${cause.address}${cause.port ? `:${cause.port}` : ""}`);
  if (Array.isArray(cause?.errors)) {
    const childErrors = cause.errors
      .map((child) => {
        const details = [child.code, child.address, child.port].filter(Boolean);
        return details.join(" ");
      })
      .filter(Boolean)
      .slice(0, 3);
    if (childErrors.length > 0) parts.push(childErrors.join(", "));
  }

  return unique(parts).join(" | ") || String(error);
}

function redactProxyUrl(proxyUrl) {
  try {
    const proxy = new URL(proxyUrl);
    if (proxy.password) proxy.password = "***";
    return proxy.href;
  } catch {
    return "configured proxy";
  }
}

function buildFetchFailure(attempts, proxyCount) {
  const details = attempts.map((attempt) => `${attempt.via}: ${attempt.error}`).join("; ");
  const hint =
    proxyCount === 0
      ? " Set SKILL_EVAL_FETCH_PROXY=http://127.0.0.1:<port> when the browser VPN exposes a local HTTP proxy."
      : "";
  const error = new Error(`Image fetch failed after ${attempts.length} attempt(s): ${details}.${hint}`.trim());
  error.attempts = attempts;
  return error;
}

async function fetchDirect(url, { timeoutMs, maxBytes }) {
  const response = await fetch(url, {
    headers: {
      accept: "image/*,*/*;q=0.8",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = Buffer.from(await response.arrayBuffer());
  assertSize(body, maxBytes);
  return {
    status: response.status,
    headers: headersToMap(response.headers),
    body,
    via: "direct",
  };
}

function defaultPort(url) {
  if (url.protocol === "https:") return 443;
  return 80;
}

function hostHeader(url) {
  const port = url.port ? Number(url.port) : defaultPort(url);
  const defaultTargetPort = defaultPort(url);
  return port === defaultTargetPort ? url.hostname : `${url.hostname}:${port}`;
}

function requestPath(url) {
  return `${url.pathname || "/"}${url.search || ""}`;
}

function absoluteRequestTarget(url) {
  return `${url.protocol}//${url.host}${requestPath(url)}`;
}

function proxyAuthorizationHeader(proxyUrl) {
  if (!proxyUrl.username) return "";
  const username = decodeURIComponent(proxyUrl.username);
  const password = decodeURIComponent(proxyUrl.password || "");
  return `Proxy-Authorization: Basic ${Buffer.from(`${username}:${password}`).toString("base64")}\r\n`;
}

function connectToProxy(proxyUrl, timeoutMs) {
  const proxyPort = Number(proxyUrl.port) || defaultPort(proxyUrl);
  return new Promise((resolve, reject) => {
    const options = {
      host: proxyUrl.hostname,
      port: proxyPort,
      servername: proxyUrl.hostname,
    };
    const socket = proxyUrl.protocol === "https:" ? tls.connect(options) : net.connect(options);
    const readyEvent = proxyUrl.protocol === "https:" ? "secureConnect" : "connect";

    const cleanup = () => {
      socket.removeListener("error", onError);
      socket.removeListener(readyEvent, onReady);
      socket.setTimeout(0);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onReady = () => {
      cleanup();
      resolve(socket);
    };

    socket.setTimeout(timeoutMs, () => {
      socket.destroy(new Error(`Proxy connection timed out after ${timeoutMs}ms`));
    });
    socket.once("error", onError);
    socket.once(readyEvent, onReady);
  });
}

function findHeaderEnd(buffer) {
  return buffer.indexOf("\r\n\r\n");
}

function parseHeaders(buffer) {
  const text = buffer.toString("latin1");
  const lines = text.split("\r\n");
  const statusLine = lines.shift() || "";
  const match = statusLine.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})\s*(.*)$/i);
  if (!match) {
    throw new Error(`Invalid HTTP response: ${statusLine || "missing status line"}`);
  }

  const headers = {};
  for (const line of lines) {
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    headers[key] = headers[key] ? `${headers[key]}, ${value}` : value;
  }

  return {
    status: Number(match[1]),
    statusText: match[2] || "",
    headers: headersToMap(headers),
  };
}

function readHeaders(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);

    const cleanup = () => {
      socket.removeListener("data", onData);
      socket.removeListener("end", onEnd);
      socket.removeListener("error", onError);
      socket.setTimeout(0);
    };
    const fail = (error) => {
      cleanup();
      reject(error);
    };
    const onError = (error) => fail(error);
    const onEnd = () => fail(new Error("Connection closed before HTTP headers were received"));
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > MAX_HEADER_BYTES) {
        fail(new Error(`HTTP headers exceed ${MAX_HEADER_BYTES} bytes`));
        return;
      }
      const headerEnd = findHeaderEnd(buffer);
      if (headerEnd === -1) return;

      const headerBuffer = buffer.subarray(0, headerEnd);
      const rest = buffer.subarray(headerEnd + 4);
      cleanup();
      try {
        resolve({
          ...parseHeaders(headerBuffer),
          rest,
        });
      } catch (error) {
        reject(error);
      }
    };

    socket.setTimeout(timeoutMs, () => fail(new Error(`HTTP header read timed out after ${timeoutMs}ms`)));
    socket.on("data", onData);
    socket.once("end", onEnd);
    socket.once("error", onError);
  });
}

function readBody(socket, headers, timeoutMs, maxBytes, initialBody = Buffer.alloc(0)) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    const contentLength = Number(headers.get("content-length"));
    const hasContentLength = Number.isFinite(contentLength) && contentLength >= 0;

    const cleanup = () => {
      socket.removeListener("data", onData);
      socket.removeListener("end", onEnd);
      socket.removeListener("error", onError);
      socket.setTimeout(0);
    };
    const fail = (error) => {
      cleanup();
      socket.destroy();
      reject(error);
    };
    const finish = () => {
      cleanup();
      const body = Buffer.concat(chunks, total);
      socket.destroy();
      resolve(body);
    };
    const onError = (error) => fail(error);
    const onEnd = () => {
      if (hasContentLength && total < contentLength) {
        fail(new Error(`HTTP body ended at ${total} bytes before content-length ${contentLength}`));
        return;
      }
      finish();
    };
    const onData = (chunk) => {
      chunks.push(chunk);
      total += chunk.length;
      if (total > maxBytes) {
        fail(new Error(`Image exceeds ${maxBytes} bytes`));
        return;
      }
      if (hasContentLength && total >= contentLength) {
        finish();
      }
    };

    socket.setTimeout(timeoutMs, () => fail(new Error(`HTTP body read timed out after ${timeoutMs}ms`)));
    socket.on("data", onData);
    socket.once("end", onEnd);
    socket.once("error", onError);
    if (initialBody.length > 0) {
      onData(initialBody);
    }
  });
}

function decodeChunkedBody(buffer) {
  let offset = 0;
  const chunks = [];
  while (offset < buffer.length) {
    const lineEnd = buffer.indexOf("\r\n", offset);
    if (lineEnd === -1) throw new Error("Invalid chunked response: missing chunk size terminator");
    const sizeText = buffer.toString("ascii", offset, lineEnd).split(";")[0].trim();
    const size = Number.parseInt(sizeText, 16);
    if (!Number.isFinite(size)) throw new Error(`Invalid chunked response size: ${sizeText}`);
    offset = lineEnd + 2;
    if (size === 0) return Buffer.concat(chunks);
    const end = offset + size;
    if (end + 2 > buffer.length) throw new Error("Invalid chunked response: incomplete chunk body");
    chunks.push(buffer.subarray(offset, end));
    offset = end + 2;
  }
  throw new Error("Invalid chunked response: missing final chunk");
}

async function readHttpMessage(socket, timeoutMs, maxBytes) {
  const response = await readHeaders(socket, timeoutMs);
  let body = await readBody(socket, response.headers, timeoutMs, maxBytes, response.rest);
  if ((response.headers.get("transfer-encoding") || "").toLowerCase().includes("chunked")) {
    body = decodeChunkedBody(body);
    assertSize(body, maxBytes);
  }
  return { ...response, body };
}

function waitForSecureConnect(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.removeListener("secureConnect", onReady);
      socket.removeListener("error", onError);
      socket.setTimeout(0);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };

    socket.setTimeout(timeoutMs, () => {
      socket.destroy(new Error(`TLS connection timed out after ${timeoutMs}ms`));
    });
    socket.once("secureConnect", onReady);
    socket.once("error", onError);
  });
}

async function sendGet(socket, targetUrl, { absoluteForm, timeoutMs, maxBytes }) {
  const requestTarget = absoluteForm ? absoluteRequestTarget(targetUrl) : requestPath(targetUrl);
  const request = [
    `GET ${requestTarget} HTTP/1.1`,
    `Host: ${hostHeader(targetUrl)}`,
    "Accept: image/*,*/*;q=0.8",
    "Accept-Encoding: identity",
    "Connection: close",
    "User-Agent: skill-eval-cache/0.1",
    "",
    "",
  ].join("\r\n");
  socket.write(request);
  return readHttpMessage(socket, timeoutMs, maxBytes);
}

async function requestViaHttpProxyOnce(targetUrl, proxyUrl, { timeoutMs, maxBytes }) {
  const proxySocket = await connectToProxy(proxyUrl, timeoutMs);

  if (targetUrl.protocol === "https:") {
    const targetHost = hostHeader(targetUrl);
    const connectRequest =
      `CONNECT ${targetHost} HTTP/1.1\r\n` +
      `Host: ${targetHost}\r\n` +
      proxyAuthorizationHeader(proxyUrl) +
      "Proxy-Connection: Keep-Alive\r\n" +
      "\r\n";
    proxySocket.write(connectRequest);

    const connectResponse = await readHeaders(proxySocket, timeoutMs);
    if (connectResponse.status < 200 || connectResponse.status > 299) {
      proxySocket.destroy();
      throw new Error(`Proxy CONNECT HTTP ${connectResponse.status}`);
    }

    const tlsSocket = tls.connect({
      socket: proxySocket,
      servername: targetUrl.hostname,
      ALPNProtocols: ["http/1.1"],
    });
    await waitForSecureConnect(tlsSocket, timeoutMs);
    return sendGet(tlsSocket, targetUrl, { absoluteForm: false, timeoutMs, maxBytes });
  }

  return sendGet(proxySocket, targetUrl, { absoluteForm: true, timeoutMs, maxBytes });
}

async function fetchViaHttpProxy(resourceUrl, proxyUrl, { timeoutMs, maxBytes }) {
  let currentUrl = new URL(resourceUrl);
  const proxy = new URL(proxyUrl);

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const response = await requestViaHttpProxyOnce(currentUrl, proxy, { timeoutMs, maxBytes });
    const location = response.headers.get("location");
    if ([301, 302, 303, 307, 308].includes(response.status) && location) {
      currentUrl = new URL(location, currentUrl);
      continue;
    }
    return {
      ...response,
      via: `proxy ${redactProxyUrl(proxy.href)}`,
    };
  }

  throw new Error(`Too many redirects (${MAX_REDIRECTS})`);
}

function isOkStatus(status) {
  return status >= 200 && status <= 299;
}

export async function fetchBinaryWithFallbacks(resourceUrl, options = {}) {
  const env = options.env || process.env;
  const timeoutMs = getFetchTimeoutMs(env, options.timeoutMs);
  const maxBytes = options.maxBytes || Infinity;
  const configuredProxies = options.proxyUrls
    ? unique(options.proxyUrls.map(normalizeProxyUrl).filter(Boolean))
    : getConfiguredFetchProxies(resourceUrl, env);
  const preferProxy = options.preferProxy ?? (options.proxyUrls ? configuredProxies.length > 0 : hasExplicitProxy(env));
  const includeDirect = options.direct !== false;
  const queue = [];

  if (preferProxy) {
    queue.push(...configuredProxies.map((proxyUrl) => ({ type: "proxy", proxyUrl })));
    if (includeDirect) queue.push({ type: "direct" });
  } else {
    if (includeDirect) queue.push({ type: "direct" });
    queue.push(...configuredProxies.map((proxyUrl) => ({ type: "proxy", proxyUrl })));
  }

  const attempts = [];
  for (const attempt of queue) {
    try {
      const response =
        attempt.type === "direct"
          ? await fetchDirect(resourceUrl, { timeoutMs, maxBytes })
          : await fetchViaHttpProxy(resourceUrl, attempt.proxyUrl, { timeoutMs, maxBytes });
      if (!isOkStatus(response.status)) {
        throw new Error(`HTTP ${response.status}`);
      }
      return {
        ...response,
        attempts,
      };
    } catch (error) {
      attempts.push({
        via: attempt.type === "direct" ? "direct" : `proxy ${redactProxyUrl(attempt.proxyUrl)}`,
        error: summarizeFetchError(error),
      });
    }
  }

  throw buildFetchFailure(attempts, configuredProxies.length);
}
