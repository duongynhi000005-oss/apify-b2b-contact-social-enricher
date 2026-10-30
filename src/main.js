import { Actor } from 'apify';
import { CheerioCrawler, log } from 'crawlee';

await Actor.init();

const input = (await Actor.getInput()) || {};
const {
    startUrls = [{ url: 'https://crawlee.dev' }],
    maxCrawlDepth = 1,
    maxRequestsPerDomain = 4,
    extractEmails = true,
    extractPhones = true,
    extractSocials = true,
    extractTechStack = true,
    extractSchemaOrg = true,
    proxyConfiguration,
    maxConcurrency = 10,
} = input;

const proxyConfig = await Actor.createProxyConfiguration(proxyConfiguration);

// In-memory store to aggregate findings per root domain
const domainDataStore = new Map();

function getDomainKey(urlStr) {
    try {
        const u = new URL(urlStr);
        return u.hostname.replace(/^www\./, '').toLowerCase();
    } catch {
        return null;
    }
}

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi;
const EMAIL_BLACKLIST_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.pdf', '.css', '.js'];
const EMAIL_BLACKLIST_DOMAINS = ['example.com', 'domain.com', 'sentry.io', 'w3.org', 'schema.org', 'cloudflare.com'];

function cleanEmails(rawEmails) {
    const cleaned = new Set();
    for (const email of rawEmails) {
        const lower = email.trim().toLowerCase();
        const hasBadExt = EMAIL_BLACKLIST_EXTENSIONS.some((ext) => lower.endsWith(ext));
        const hasBadDomain = EMAIL_BLACKLIST_DOMAINS.some((d) => lower.includes(d));
        if (!hasBadExt && !hasBadDomain && lower.length <= 80) {
            cleaned.add(lower);
        }
    }
    return Array.from(cleaned);
}

const PHONE_REGEX = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g;

function cleanPhones(rawPhones) {
    const cleaned = new Set();
    for (const p of rawPhones) {
        const sanitized = p.trim().replace(/[^\d+]/g, '');
        if (sanitized.length >= 7 && sanitized.length <= 16) {
            cleaned.add(p.trim());
        }
    }
    return Array.from(cleaned);
}

const TECH_SIGNATURES = [
    { name: 'Shopify', test: (html) => html.includes('cdn.shopify.com') || html.includes('Shopify.theme') },
    { name: 'WordPress', test: (html) => html.includes('wp-content') || html.includes('wp-includes') },
    { name: 'WooCommerce', test: (html) => html.includes('woocommerce') },
    { name: 'Webflow', test: (html) => html.includes('webflow.js') || html.includes('data-wf-page') },
    { name: 'Squarespace', test: (html) => html.includes('static1.squarespace.com') },
    { name: 'Wix', test: (html) => html.includes('static.wixstatic.com') || html.includes('wix-warmup-data') },
    { name: 'HubSpot', test: (html) => html.includes('js.hs-scripts.com') || html.includes('hs-banner') },
    { name: 'Next.js', test: (html) => html.includes('__NEXT_DATA__') || html.includes('/_next/') },
    { name: 'React', test: (html) => html.includes('data-reactroot') || html.includes('react.production.min.js') },
    { name: 'Google Tag Manager', test: (html) => html.includes('googletagmanager.com/gtm.js') },
    { name: 'Google Analytics (GA4)', test: (html) => html.includes('googletagmanager.com/gtag/js') },
    { name: 'Stripe', test: (html) => html.includes('js.stripe.com') },
    { name: 'Intercom', test: (html) => html.includes('widget.intercom.io') },
    { name: 'Cloudflare', test: (html) => html.includes('cloudflare.com') || html.includes('cf-beacon') },
    { name: 'Tailwind CSS', test: (html) => html.includes('tailwind') },
];

const crawler = new CheerioCrawler({
    proxyConfiguration: proxyConfig,
    maxConcurrency,
    requestHandlerTimeoutSecs: 30,
    maxRequestsPerCrawl: 5000,
    async requestHandler({ $, request, enqueueLinks }) {
        const { url } = request;
        const domain = getDomainKey(url);
        if (!domain) return;

        if (!domainDataStore.has(domain)) {
            domainDataStore.set(domain, {
                domain,
                websiteUrl: `https://${domain}`,
                companyName: '',
                metaTitle: '',
                metaDescription: '',
                emails: new Set(),
                phones: new Set(),
                socialLinks: {
                    linkedin: null,
                    twitter: null,
                    facebook: null,
                    instagram: null,
                    youtube: null,
                    github: null,
                },
                techStack: new Set(),
                schemaOrg: [],
                pagesVisited: 0,
                charged: false,
            });
        }

        const lead = domainDataStore.get(domain);
        lead.pagesVisited += 1;

        const html = $.html();
        const bodyText = $('body').text() || '';

        if (!lead.metaTitle) {
            lead.metaTitle = $('title').first().text().trim();
            lead.metaDescription = $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '';
            lead.companyName = $('meta[property="og:site_name"]').attr('content') || lead.metaTitle.split(/[-|•:]/)[0].trim();
        }

        if (extractEmails) {
            $('a[href^="mailto:"]').each((_, el) => {
                const raw = $(el).attr('href')?.replace(/^mailto:/i, '').split('?')[0];
                if (raw) lead.emails.add(raw.trim());
            });
            const matched = bodyText.match(EMAIL_REGEX) || [];
            for (const m of matched) lead.emails.add(m);
        }

        if (extractPhones) {
            $('a[href^="tel:"]').each((_, el) => {
                const raw = $(el).attr('href')?.replace(/^tel:/i, '').split('?')[0];
                if (raw) lead.phones.add(raw.trim());
            });
            const footerAndContact = $('footer, .footer, #footer, .contact, #contact, address').text();
            const matched = footerAndContact.match(PHONE_REGEX) || [];
            for (const p of matched) lead.phones.add(p);
        }

        if (extractSocials) {
            $('a[href]').each((_, el) => {
                const href = $(el).attr('href')?.trim();
                if (!href) return;
                const lower = href.toLowerCase();

                if (!lead.socialLinks.linkedin && lower.includes('linkedin.com/')) {
                    lead.socialLinks.linkedin = href;
                } else if (!lead.socialLinks.twitter && (lower.includes('twitter.com/') || lower.includes('x.com/'))) {
                    lead.socialLinks.twitter = href;
                } else if (!lead.socialLinks.facebook && lower.includes('facebook.com/') && !lower.includes('sharer')) {
                    lead.socialLinks.facebook = href;
                } else if (!lead.socialLinks.instagram && lower.includes('instagram.com/')) {
                    lead.socialLinks.instagram = href;
                } else if (!lead.socialLinks.youtube && lower.includes('youtube.com/')) {
                    lead.socialLinks.youtube = href;
                } else if (!lead.socialLinks.github && lower.includes('github.com/')) {
                    lead.socialLinks.github = href;
                }
            });
        }

        if (extractTechStack) {
            for (const sig of TECH_SIGNATURES) {
                if (sig.test(html)) {
                    lead.techStack.add(sig.name);
                }
            }
        }

        if (extractSchemaOrg) {
            $('script[type="application/ld+json"]').each((_, el) => {
                try {
                    const rawJson = $(el).html()?.trim();
                    if (rawJson) {
                        const parsed = JSON.parse(rawJson);
                        const items = Array.isArray(parsed) ? parsed : [parsed];
                        for (const it of items) {
                            if (it['@type'] && ['Organization', 'LocalBusiness', 'Corporation'].some((t) => JSON.stringify(it['@type']).includes(t))) {
                                lead.schemaOrg.push({
                                    type: it['@type'],
                                    name: it.name || null,
                                    telephone: it.telephone || null,
                                    email: it.email || null,
                                    address: it.address || null,
                                    geo: it.geo || null,
                                });
                            }
                        }
                    }
                } catch {
                    // Ignore malformed JSON-LD
                }
            });
        }

        if (maxCrawlDepth > 0 && lead.pagesVisited < maxRequestsPerDomain) {
            await enqueueLinks({
                globs: [
                    `https://${domain}/*contact*`,
                    `https://${domain}/*about*`,
                    `https://${domain}/*team*`,
                    `https://${domain}/*imprint*`,
                    `https://${domain}/*privacy*`,
                ],
                strategy: 'same-domain',
                limit: maxRequestsPerDomain - lead.pagesVisited,
            });
        }
    },
    async failedRequestHandler({ request }, error) {
        log.warning(`Request failed: ${request.url} - ${error.message}`);
    },
});

log.info(`Starting crawl for ${startUrls.length} target URLs...`);
await crawler.run(startUrls);

log.info('Crawl completed. Finalizing dataset and triggering PPE charges...');

let totalChargedLeads = 0;

for (const [domain, rawLead] of domainDataStore.entries()) {
    const cleanedEmails = cleanEmails(Array.from(rawLead.emails));
    const cleanedPhones = cleanPhones(Array.from(rawLead.phones));
    const techArray = Array.from(rawLead.techStack);

    const hasData = cleanedEmails.length > 0 ||
                    cleanedPhones.length > 0 ||
                    rawLead.socialLinks.linkedin ||
                    rawLead.socialLinks.twitter ||
                    rawLead.companyName;

    if (hasData) {
        try {
            await Actor.charge({ eventName: 'lead-enriched', count: 1 });
            totalChargedLeads += 1;
        } catch (chargeErr) {
            log.warning(`Actor.charge error for ${domain}: ${chargeErr.message}`);
        }
    }

    await Actor.pushData({
        domain,
        websiteUrl: rawLead.websiteUrl,
        companyName: rawLead.companyName,
        metaTitle: rawLead.metaTitle,
        metaDescription: rawLead.metaDescription,
        emails: cleanedEmails,
        primaryEmail: cleanedEmails[0] || null,
        phones: cleanedPhones,
        primaryPhone: cleanedPhones[0] || null,
        socialLinks: rawLead.socialLinks,
        techStack: techArray,
        schemaOrgData: rawLead.schemaOrg.length > 0 ? rawLead.schemaOrg : null,
        enrichedAt: new Date().toISOString(),
        qualityScore: calculateQualityScore(cleanedEmails, cleanedPhones, rawLead.socialLinks),
    });
}

function calculateQualityScore(emails, phones, socials) {
    let score = 20;
    if (emails.length > 0) score += 40;
    if (phones.length > 0) score += 20;
    if (socials.linkedin) score += 10;
    if (socials.twitter || socials.facebook) score += 10;
    return Math.min(score, 100);
}

log.info(`Enrichment finished! Total leads charged: ${totalChargedLeads}`);
await Actor.exit();
