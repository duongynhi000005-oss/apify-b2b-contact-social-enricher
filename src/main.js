import { Actor } from 'apify';
import * as cheerio from 'cheerio';

await Actor.init();

const input = (await Actor.getInput()) || {};
const startUrls = Array.isArray(input.startUrls) && input.startUrls.length > 0
    ? input.startUrls
    : [{ url: 'https://apify.com' }];
const crawlSubpages = input.crawlSubpages !== false;
const maxSubpagesPerDomain = Number(input.maxSubpagesPerDomain ?? 5);

const TECH_SIGNATURES = [
    { name: 'HubSpot', re: /js\.hs-scripts\.com|hs-analytics|hubspot\.com|hbspt\.forms/i },
    { name: 'Salesforce', re: /salesforce\.com|pardot\.com|force\.com/i },
    { name: 'Stripe', re: /js\.stripe\.com|stripe\.com/i },
    { name: 'Shopify', re: /cdn\.shopify\.com|Shopify\.shop/i },
    { name: 'WooCommerce', re: /woocommerce|wc-api/i },
    { name: 'Intercom', re: /widget\.intercom\.io|intercomSettings/i },
    { name: 'Zendesk', re: /zdassets\.com|zendesk\.com/i },
    { name: 'Drift', re: /js\.driftt\.com|drift\.com/i },
    { name: 'Crisp', re: /client\.crisp\.chat/i },
    { name: 'Segment', re: /cdn\.segment\.com|analytics\.load/i },
    { name: 'Google Tag Manager', re: /googletagmanager\.com\/gtm\.js/i },
    { name: 'Google Analytics 4', re: /googletagmanager\.com\/gtag\/js|G-[A-Z0-9]{6,}/i },
    { name: 'Meta Pixel', re: /connect\.facebook\.net.*fbevents\.js|fbq\(/i },
    { name: 'LinkedIn Insight Tag', re: /snap\.licdn\.com\/li\.lms-analytics/i },
    { name: 'Klaviyo', re: /static\.klaviyo\.com/i },
    { name: 'Mailchimp', re: /chimpstatic\.com|list-manage\.com/i },
    { name: 'Hotjar', re: /static\.hotjar\.com/i },
    { name: 'Mixpanel', re: /cdn\.mxpnl\.com|mixpanel/i },
    { name: 'PostHog', re: /posthog\.com|app\.posthog/i },
    { name: 'Sentry', re: /browser\.sentry-cdn\.com|sentry\.io/i },
    { name: 'Cloudflare', re: /cdnjs\.cloudflare\.com|__cf_bm|cf-ray/i },
    { name: 'Next.js', re: /\/_next\/static\/|__NEXT_DATA__/i },
    { name: 'Nuxt.js', re: /\/_nuxt\/|__NUXT__/i },
    { name: 'Webflow', re: /assets\.website-files\.com|webflow\.com|data-wf-site/i },
    { name: 'WordPress', re: /\/wp-content\/|\/wp-includes\//i },
    { name: 'Calendly', re: /assets\.calendly\.com|calendly\.com\//i }
];

const JUNK_EMAIL_RE = /\.(png|jpg|jpeg|gif|svg|webp|css|js|woff|woff2|ttf|eot|ico|mp4|pdf)$|^(noreply|no-reply|donotreply|example|test|user|email|yourname|name|sentry)@|@(sentry\.io|example\.com|domain\.com|wixpress\.com|email\.com)/i;

async function fetchHtml(url, timeoutMs = 12000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            signal: ctrl.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        });
        if (!res.ok) return { html: '', status: res.status };
        return { html: await res.text(), status: res.status };
    } catch {
        return { html: '', status: 0 };
    } finally {
        clearTimeout(timer);
    }
}

for (const item of startUrls) {
    const rawUrl = typeof item === 'string' ? item : item?.url;
    if (!rawUrl) continue;
    const baseUrl = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
    let parsedBase;
    try {
        parsedBase = new URL(baseUrl);
    } catch {
        continue;
    }

    const emails = new Set();
    const phones = new Set();
    const socials = { linkedin: [], twitter: [], facebook: [], instagram: [], youtube: [], github: [], tiktok: [] };
    const techStack = new Set();
    const pagesCrawled = [];
    let companyName = '';
    let description = '';
    let orgSchema = {};

    const firstPass = await fetchHtml(baseUrl);
    if (!firstPass.html) {
        await Actor.pushData({ url: baseUrl, domain: parsedBase.hostname, status: 'UNREACHABLE', leadScore: 0 });
        continue;
    }
    pagesCrawled.push(baseUrl);

    const candidateSubpages = new Set();
    const processHtml = (html, pageUrl) => {
        const $ = cheerio.load(html);
        if (!companyName) {
            companyName = $('meta[property="og:site_name"]').attr('content')
                || $('title').first().text().trim().split(/[|\-–—]/)[0].trim();
        }
        if (!description) {
            description = $('meta[name="description"]').attr('content')
                || $('meta[property="og:description"]').attr('content') || '';
        }

        for (const sig of TECH_SIGNATURES) {
            if (sig.re.test(html)) techStack.add(sig.name);
        }

        $('script[type="application/ld+json"]').each((_, el) => {
            try {
                const parsed = JSON.parse($(el).html() || '{}');
                const nodes = Array.isArray(parsed) ? parsed : (parsed['@graph'] || [parsed]);
                for (const n of nodes) {
                    const t = String(n['@type'] || '');
                    if (/Organization|Corporation|LocalBusiness|Brand/i.test(t)) {
                        orgSchema = {
                            legalName: n.legalName || n.name || orgSchema.legalName,
                            foundingDate: n.foundingDate || orgSchema.foundingDate,
                            taxID: n.taxID || n.vatID || orgSchema.taxID,
                            address: typeof n.address === 'object' ? JSON.stringify(n.address) : n.address
                        };
                    }
                }
            } catch {}
        });

        const rawEmails = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,12}/g) || [];
        for (const em of rawEmails) {
            const clean = em.toLowerCase().trim();
            if (!JUNK_EMAIL_RE.test(clean)) emails.add(clean);
        }

        $('a[href^="mailto:"]').each((_, el) => {
            const m = ($(el).attr('href') || '').replace(/^mailto:/i, '').split('?')[0].trim().toLowerCase();
            if (m && !JUNK_EMAIL_RE.test(m)) emails.add(m);
        });

        $('a[href^="tel:"]').each((_, el) => {
            const p = ($(el).attr('href') || '').replace(/^tel:/i, '').trim();
            if (p.length >= 7) phones.add(p);
        });
        const rawPhones = html.match(/(?:\+\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]\d{3,4}[\s.-]\d{3,4}/g) || [];
        for (const p of rawPhones.slice(0, 15)) {
            if (p.replace(/\D/g, '').length >= 9 && p.replace(/\D/g, '').length <= 15) {
                phones.add(p.trim());
            }
        }

        $('a[href]').each((_, el) => {
            const href = ($(el).attr('href') || '').trim();
            if (!href) return;
            try {
                const abs = new URL(href, pageUrl).href;
                const low = abs.toLowerCase();
                if (low.includes('linkedin.com/') && !socials.linkedin.includes(abs)) socials.linkedin.push(abs);
                else if ((low.includes('twitter.com/') || low.includes('x.com/')) && !socials.twitter.includes(abs)) socials.twitter.push(abs);
                else if (low.includes('facebook.com/') && !socials.facebook.includes(abs)) socials.facebook.push(abs);
                else if (low.includes('instagram.com/') && !socials.instagram.includes(abs)) socials.instagram.push(abs);
                else if (low.includes('youtube.com/') && !socials.youtube.includes(abs)) socials.youtube.push(abs);
                else if (low.includes('github.com/') && !socials.github.includes(abs)) socials.github.push(abs);
                else if (low.includes('tiktok.com/') && !socials.tiktok.includes(abs)) socials.tiktok.push(abs);

                const u = new URL(abs);
                if (u.hostname === parsedBase.hostname && /\/(contact|about|team|company|impressum|legal|privacy|support|pricing|careers)/i.test(u.pathname)) {
                    candidateSubpages.add(u.origin + u.pathname);
                }
            } catch {}
        });
    };

    processHtml(firstPass.html, baseUrl);

    if (crawlSubpages) {
        const subpageList = Array.from(candidateSubpages).slice(0, maxSubpagesPerDomain);
        for (const subUrl of subpageList) {
            if (pagesCrawled.includes(subUrl)) continue;
            const subRes = await fetchHtml(subUrl, 8000);
            if (subRes.html) {
                pagesCrawled.push(subUrl);
                processHtml(subRes.html, subUrl);
            }
        }
    }

    const emailArr = Array.from(emails);
    const domainEmails = emailArr.filter((e) => e.endsWith('@' + parsedBase.hostname.replace(/^www\./, '')));
    const socialCount = Object.values(socials).reduce((acc, arr) => acc + arr.length, 0);
    const leadScore = Math.min(
        100,
        (emailArr.length > 0 ? 35 : 0) +
        (domainEmails.length > 0 ? 15 : 0) +
        (phones.size > 0 ? 15 : 0) +
        Math.min(20, socialCount * 5) +
        Math.min(15, techStack.size * 3)
    );

    await Actor.pushData({
        url: baseUrl,
        domain: parsedBase.hostname.replace(/^www\./, ''),
        companyName: companyName || parsedBase.hostname,
        description: description.slice(0, 400),
        leadScore,
        emails: emailArr,
        corporateDomainEmails: domainEmails,
        phones: Array.from(phones).slice(0, 10),
        socials,
        techStack: Array.from(techStack),
        organizationSchema: orgSchema,
        pagesCrawledCount: pagesCrawled.length,
        pagesCrawled,
        scrapedAt: new Date().toISOString()
    });
}

await Actor.exit();
