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
const ARTICLE_JUNK_HINT_RE = /\b(related|recommended|more headlines|latest headlines|top stories|read more|you may also like|most read|live updates|watch live|newsletter|sign up|advertisement|trending|popular now|more coverage|up next)\b/i;
const ARTICLE_DROP_SELECTOR = [
  "script",
  "style",
  "noscript",
  "iframe",
  "nav",
  "aside",
  "footer",
  "form",
  "button",
  "[role='navigation']",
  "[aria-label*='related' i]",
  "[class*='related' i]",
  "[class*='recommended' i]",
  "[class*='newsletter' i]",
  "[class*='promo' i]",
  "[class*='advert' i]",
  "[class*='trending' i]",
  "[class*='popular' i]",
  "[class*='most-read' i]",
  "[class*='live-blog' i]",
  "[id*='related' i]",
  "[id*='recommended' i]",
  "[id*='trending' i]"
].join(",");

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

function normalizeWhitespace(value = "") {
  return decodeEntities(String(value).replace(/\s+/g, " ").trim());
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

function textLength(node) {
  return normalizeWhitespace(node?.textContent || "").length;
}

function removeJunkNodes(root) {
  root.querySelectorAll(ARTICLE_DROP_SELECTOR).forEach((node) => node.remove());

  root.querySelectorAll("section, div, ul, ol, aside").forEach((node) => {
    const tagName = node.tagName?.toLowerCase() || "";
    if (!node.parentElement || node === root || tagName === "body") {
      return;
    }

    const text = normalizeWhitespace(node.textContent || "");
    const paragraphs = node.querySelectorAll("p").length;
    const links = node.querySelectorAll("a").length;
    const listItems = node.querySelectorAll("li").length;
    const headingCount = node.querySelectorAll("h2,h3,h4").length;
    const linkText = Array.from(node.querySelectorAll("a")).reduce((sum, link) => sum + normalizeWhitespace(link.textContent || "").length, 0);
    const linkDensity = linkText / Math.max(1, text.length);
    const attrText = `${node.id || ""} ${node.className || ""} ${node.getAttribute("aria-label") || ""}`;

    if (paragraphs >= 4 || text.length >= 1800) {
      return;
    }

    if (ARTICLE_JUNK_HINT_RE.test(attrText) && paragraphs <= 2 && text.length < 1200) {
      node.remove();
      return;
    }

    if (ARTICLE_JUNK_HINT_RE.test(text.slice(0, 180)) && paragraphs <= 2 && links >= 2 && text.length < 900) {
      node.remove();
      return;
    }

    if (listItems >= 4 && paragraphs <= 2 && links >= Math.max(3, Math.floor(listItems / 2))) {
      node.remove();
      return;
    }

    if (headingCount >= 4 && paragraphs <= 2 && linkDensity > 0.24) {
      node.remove();
      return;
    }

    if (linkDensity > 0.36 && text.length < 700) {
      node.remove();
    }
  });
}

function extractMeta(document, selector) {
  const match = document.querySelector(selector);
  return match?.getAttribute("content")?.trim() || "";
}

function extractLeadImage(document) {
  return (
    extractMeta(document, "meta[property='og:image']") ||
    extractMeta(document, "meta[name='twitter:image']") ||
    document.querySelector("img")?.getAttribute("src") ||
    ""
  );
}

function analyzeArticleHtml(content, textContent = "") {
  const { document } = parseHTML("<div id='analysis-root'></div>");
  const root = document.getElementById("analysis-root");
  root.innerHTML = content || "";
  const originalHtml = root.innerHTML;
  const originalText = normalizeWhitespace(root.textContent || textContent || "");
  const scoredRoot = root.cloneNode(true);
  removeJunkNodes(scoredRoot);

  let activeRoot = scoredRoot;
  let text = normalizeWhitespace(scoredRoot.textContent || "");
  if (text.length < Math.min(600, Math.max(220, Math.round(originalText.length * 0.25)))) {
    activeRoot = root;
    text = originalText;
  }

  const paragraphs = Array.from(activeRoot.querySelectorAll("p")).map((node) => normalizeWhitespace(node.textContent || "")).filter((value) => value.length >= 45);
  const listItems = activeRoot.querySelectorAll("li").length;
  const headingLike = Array.from(activeRoot.querySelectorAll("li,h2,h3,h4")).filter((node) => {
    const value = normalizeWhitespace(node.textContent || "");
    return value.length >= 18 && value.length <= 120 && !/[.!?]/.test(value);
  }).length;
  const linkTextLength = Array.from(activeRoot.querySelectorAll("a")).reduce((sum, link) => sum + normalizeWhitespace(link.textContent || "").length, 0);
  const linkDensity = linkTextLength / Math.max(1, text.length);
  const warnings = [];

  if (text.length < 500 || paragraphs.length < 2) warnings.push("thin_content");
  if (linkDensity > 0.24) warnings.push("high_link_density");
  if (listItems >= 6 && paragraphs.length <= 4) warnings.push("headline_list");
  if (headingLike >= 8 && paragraphs.length <= 4) warnings.push("headline_noise");
  if (ARTICLE_JUNK_HINT_RE.test(text)) warnings.push("related_content");

  let qualityScore = 1;
  if (warnings.includes("thin_content")) qualityScore -= 0.4;
  if (warnings.includes("high_link_density")) qualityScore -= 0.28;
  if (warnings.includes("headline_list")) qualityScore -= 0.36;
  if (warnings.includes("headline_noise")) qualityScore -= 0.3;
  if (warnings.includes("related_content")) qualityScore -= 0.14;

  return {
    cleanedContent: activeRoot.innerHTML || originalHtml,
    qualityScore: Math.max(0, Number(qualityScore.toFixed(2))),
    warnings,
    paragraphCount: paragraphs.length,
    textLength: text.length,
    fallbackPreferred: (
      qualityScore < 0.48 ||
      warnings.includes("headline_list") ||
      warnings.includes("headline_noise") ||
      (warnings.includes("thin_content") && paragraphs.length <= 3 && text.length < 900)
    )
  };
}

function buildArticleResponse({
  title,
  byline = "",
  siteName = "",
  excerpt = "",
  content = "",
  textContent = "",
  url,
  leadImage = "",
  mode = "reader",
  qualityScore = 0,
  warnings = [],
  paragraphCount = 0,
  textLength = 0,
  fallbackPreferred = false
}) {
  return jsonResponse({
    title: title || "Article",
    byline,
    siteName,
    excerpt,
    content,
    textContent,
    length: textLength || textContent.length,
    url,
    leadImage,
    mode,
    qualityScore,
    warnings,
    paragraphCount,
    textLength,
    fallbackPreferred
  });
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
  removeJunkNodes(document);
  const leadImage = extractLeadImage(document);
  const metaDescription = extractMeta(document, "meta[name='description']") || extractMeta(document, "meta[property='og:description']");
  const pageTitle = document.title?.trim() || extractMeta(document, "meta[property='og:title']") || safeHost(safeUrl);
  const siteName = extractMeta(document, "meta[property='og:site_name']") || safeHost(safeUrl);
  const reader = new Readability(document, {
    charThreshold: 180
  });
  const article = reader.parse();

  if (!article) {
    return buildArticleResponse({
      title: pageTitle,
      siteName,
      excerpt: metaDescription,
      url: safeUrl,
      leadImage,
      mode: "source_only",
      qualityScore: 0,
      warnings: ["readability_failed"],
      paragraphCount: 0,
      textLength: metaDescription.length,
      fallbackPreferred: true
    });
  }

  const analysis = analyzeArticleHtml(article.content, article.textContent);
  return buildArticleResponse({
    title: article.title,
    byline: article.byline,
    siteName: article.siteName || siteName,
    excerpt: article.excerpt || metaDescription,
    content: analysis.cleanedContent,
    textContent: article.textContent,
    url: safeUrl,
    leadImage,
    mode: analysis.fallbackPreferred ? "source_only" : "reader",
    qualityScore: analysis.qualityScore,
    warnings: analysis.warnings,
    paragraphCount: analysis.paragraphCount,
    textLength: analysis.textLength,
    fallbackPreferred: analysis.fallbackPreferred
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
