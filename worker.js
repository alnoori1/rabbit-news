import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store, max-age=0"
};

const REQUEST_TIMEOUT_MS = 10000;
const MAX_HTML_BYTES = 2_000_000;
const MAX_RSS_ITEMS = 60;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function assertHttpUrl(value) {
  const target = new URL(value);
  if (!/^https?:$/.test(target.protocol)) {
    throw new Error("Only http and https URLs are supported.");
  }
  return target.toString();
}

function decodeEntities(text = "") {
  return text
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function safeHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
}

function parsePublishedTs(value = "") {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function unwrapKnownRedirect(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("bing.com") && parsed.pathname.includes("/news/apiclick.aspx")) {
      return parsed.searchParams.get("url") || url;
    }
    return url;
  } catch {
    return url;
  }
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort("timeout"), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      redirect: "follow",
      ...init,
      signal: controller.signal,
      cf: {
        cacheEverything: false,
        cacheTtl: 0
      }
    });
    return response;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Upstream request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readTextSafely(response) {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength && declaredLength > MAX_HTML_BYTES) {
    throw new Error("Upstream document is too large to parse.");
  }

  const reader = response.body?.getReader?.();
  if (!reader) {
    return response.text();
  }

  const decoder = new TextDecoder();
  let total = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > MAX_HTML_BYTES) {
      reader.cancel();
      throw new Error("Upstream document exceeded the parser limit.");
    }
    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();
  return text;
}

function extractTag(itemXml, tag) {
  const match = new RegExp(`<${tag}(?:[^>]*)>([\\s\\S]*?)<\\/${tag}>`, "i").exec(itemXml);
  return match ? decodeEntities(match[1]) : "";
}

function extractImage(itemXml, description) {
  const mediaContent = /<media:content[^>]+url="([^"]+)"/i.exec(itemXml);
  if (mediaContent) {
    return mediaContent[1];
  }

  const mediaThumb = /<media:thumbnail[^>]+url="([^"]+)"/i.exec(itemXml);
  if (mediaThumb) {
    return mediaThumb[1];
  }

  const enclosure = /<enclosure[^>]+url="([^"]+)"[^>]+type="image\//i.exec(itemXml);
  if (enclosure) {
    return enclosure[1];
  }

  const descriptionImage = /<img[^>]+src=["']([^"']+)["']/i.exec(description);
  if (descriptionImage) {
    return descriptionImage[1];
  }

  const rawImage = /https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp)/i.exec(itemXml);
  return rawImage ? rawImage[0] : "";
}

async function handleRSS(targetUrl) {
  const safeUrl = assertHttpUrl(targetUrl);
  const response = await fetchWithTimeout(safeUrl, {
    headers: {
      "Cache-Control": "no-store"
    }
  });

  if (!response.ok) {
    throw new Error(`Feed request failed (${response.status}).`);
  }

  const xml = await readTextSafely(response);
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match = null;

  while ((match = itemRegex.exec(xml)) !== null && items.length < MAX_RSS_ITEMS) {
    const itemXml = match[1];
    const title = extractTag(itemXml, "title");
    const link = unwrapKnownRedirect(extractTag(itemXml, "link") || extractTag(itemXml, "guid") || safeUrl);
    const description = extractTag(itemXml, "description") || extractTag(itemXml, "content:encoded");
    const published = extractTag(itemXml, "pubDate") || new Date().toISOString();
    const publishedTs = parsePublishedTs(published);
    const image = extractImage(itemXml, description);
    const source = extractTag(itemXml, "source") || safeHost(link);

    items.push({
      title: title || "Untitled story",
      url: link,
      link,
      source,
      published,
      publishedTs,
      summary: description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 220),
      image: image ? { url: image } : null
    });
  }

  items.sort((left, right) => (right.publishedTs || 0) - (left.publishedTs || 0));
  return jsonResponse({ items, fetchedAt: new Date().toISOString() });
}

async function handleArticle(targetUrl) {
  const safeUrl = assertHttpUrl(targetUrl);
  const response = await fetchWithTimeout(safeUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Cache-Control": "no-store"
    }
  });

  if (!response.ok) {
    throw new Error(`Article request failed (${response.status}).`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("html") && !contentType.includes("xml") && !contentType.includes("text/plain")) {
    throw new Error("Unsupported article content type.");
  }

  let html = await readTextSafely(response);
  html = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");

  const { document } = parseHTML(html);
  const reader = new Readability(document, {
    charThreshold: 180
  });
  const article = reader.parse();

  if (!article) {
    throw new Error("Readability could not extract the article.");
  }

  return jsonResponse({
    title: article.title,
    byline: article.byline,
    siteName: article.siteName,
    excerpt: article.excerpt,
    content: article.content,
    textContent: article.textContent,
    length: article.length,
    url: safeUrl
  });
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return jsonResponse({ status: "ok" });
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405);
    }

    try {
      const payload = await request.json();
      if (!payload?.url) {
        throw new Error("Missing url parameter.");
      }

      if (url.pathname === "/top") {
        return await handleRSS(payload.url);
      }

      if (url.pathname === "/article") {
        return await handleArticle(payload.url);
      }

      return jsonResponse({ error: "Not found." }, 404);
    } catch (error) {
      return jsonResponse({ error: error.message || "Request failed." }, 400);
    }
  }
};
