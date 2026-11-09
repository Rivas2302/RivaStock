const MULTI_LABEL_SUFFIXES = new Set([
  'ac.uk', 'co.uk', 'gov.uk', 'ltd.uk', 'me.uk', 'net.uk', 'org.uk', 'plc.uk', 'sch.uk',
  'com.ar', 'net.ar', 'org.ar', 'gov.ar', 'edu.ar', 'mil.ar', 'tur.ar',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'asn.au', 'id.au',
  'co.nz', 'net.nz', 'org.nz', 'ac.nz', 'govt.nz',
  'com.br', 'net.br', 'org.br', 'com.mx', 'com.co', 'com.pe', 'com.uy',
  'co.jp', 'ne.jp', 'or.jp', 'com.cn', 'net.cn', 'org.cn', 'com.hk', 'com.sg', 'com.tw', 'com.tr', 'com.in',
  'github.io', 'vercel.app', 'netlify.app', 'pages.dev', 'web.app', 'appspot.com', 'herokuapp.com',
  'blogspot.com', 'wordpress.com', 'wixsite.com', 'squarespace.com', 'cloudfront.net', 'azurewebsites.net', 'firebaseapp.com',
]);
const COMMON_COUNTRY_SECOND_LEVELS = new Set(['ac', 'co', 'com', 'edu', 'gov', 'mil', 'net', 'org', 'nom']);

export function getSupplierSiteDomain(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    if (!hostname || hostname.includes(':') || /^\d+(?:\.\d+){3}$/.test(hostname)) return null;
    const labels = hostname.split('.');
    if (labels.length < 2) return null;
    const lastTwo = labels.slice(-2).join('.');
    const lastLabel = labels.at(-1);
    const suffixLength = MULTI_LABEL_SUFFIXES.has(lastTwo)
      || (lastLabel?.length === 2 && COMMON_COUNTRY_SECOND_LEVELS.has(labels.at(-2))) ? 2 : 1;
    return labels.length > suffixLength ? labels.slice(-(suffixLength + 1)).join('.') : null;
  } catch { return null; }
}

export function isSameSupplierSiteDomain(sourceUrl, candidateUrl) {
  const sourceDomain = getSupplierSiteDomain(sourceUrl);
  return Boolean(sourceDomain && sourceDomain === getSupplierSiteDomain(candidateUrl));
}
