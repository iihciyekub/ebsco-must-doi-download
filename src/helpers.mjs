import path from 'node:path';

export const ORIGIN = 'https://research-ebsco-com.libezproxy.must.edu.mo';
export const OPID = '6dso22';

export function extractDois(text) {
  // DOI Handbook/Crossref 常用前缀规则，并在后缀处排除空白、CSV 分隔符和 HTML 包围符。
  const candidates = text
    .replace(/%2F/gi, '/')
    .match(/10\.\d{4,9}\/[^\s"',<>\[\]{}]+/gi) ?? [];
  const seen = new Set();
  const dois = [];

  for (const candidate of candidates) {
    let doi = candidate.replace(/[.;:!?]+$/g, '');
    while (doi.endsWith(')')) {
      const opens = (doi.match(/\(/g) ?? []).length;
      const closes = (doi.match(/\)/g) ?? []).length;
      if (closes <= opens) break;
      doi = doi.slice(0, -1);
    }
    try {
      doi = normalizeDoi(doi);
    } catch {
      continue;
    }
    const key = doi.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      dois.push(doi);
    }
  }
  return dois;
}

export function normalizeDoi(input) {
  const value = input.trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '');

  if (!/^10\.\d{4,9}\/\S+$/i.test(value)) {
    throw new Error(`无效 DOI：${input}`);
  }
  return value;
}

export function buildSearchUrl(doi) {
  const params = new URLSearchParams({
    q: doi,
    autocorrect: 'y',
    db: 'bsu',
    expanders: 'concept',
    limiters: 'FT:Y',
    searchMode: 'boolean',
    searchSegment: 'all-results',
    p: '1',
    skipResultsFetch: 'true'
  });
  return `${ORIGIN}/c/${OPID}/search/advanced-results?${params}`;
}

export function extractRecordId(href) {
  let url;
  try {
    url = new URL(href, ORIGIN);
  } catch {
    throw new Error(`无法从首条结果链接提取 record ID：${href}`);
  }

  const parts = url.pathname.split('/').filter(Boolean);
  const detailsIndex = parts.lastIndexOf('details');
  const encodedId = parts[detailsIndex + 1];
  if (detailsIndex < 0 || !encodedId) {
    throw new Error(`无法从首条结果链接提取 record ID：${href}`);
  }

  const recordId = decodeURIComponent(encodedId);
  if (!/^[a-z0-9_-]+$/i.test(recordId)) {
    throw new Error(`首条结果的 record ID 格式异常：${recordId}`);
  }
  return recordId;
}

export function buildPdfUrl(recordId) {
  const encoded = encodeURIComponent(recordId);
  const params = new URLSearchParams({
    sourceRecordId: recordId,
    opid: OPID,
    intent: 'download',
    lang: 'en'
  });
  return `${ORIGIN}/api/search/v1/record/${encoded}/fulltext/pdf?${params}`;
}

export function pdfFilename(doi) {
  const safe = doi
    .replace(/\//g, '_')
    .replace(/[\\\0<>:"|?*\x00-\x1F]/g, '_')
    .replace(/[. ]+$/g, '');
  return `${safe}.pdf`;
}

export function resolveFromCwd(value) {
  return path.resolve(process.cwd(), value);
}
