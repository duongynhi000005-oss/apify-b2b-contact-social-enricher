# B2B Contact, Email, Tech Stack & Decision-Maker Enricher

Deep multi-page B2B lead intelligence crawler: extracts verified corporate emails, phone numbers, LinkedIn/X/GitHub socials, 25+ SaaS/Tech Stack signals (HubSpot, Salesforce, Stripe, Shopify, GA4), JSON-LD Organization data, and 0-100 Lead Quality Score.

## Why Use B2B Contact, Email, Tech Stack & Decision-Maker Enricher?
- **Production-Grade & Zero Maintenance**: Built specifically for automated workflows in **n8n, Make.com, Zapier, Clay, LangChain, and MCP servers**.
- **Pay-Per-Event (PPE) Transparent Pricing**: Only **$0.005 per enriched result** (`$5.00 per 1,000 results`) with structured JSON, CSV, and Excel export.
- **Fast & Lightweight**: Uses high-concurrency HTTP parsing and structured JSON-LD / API discovery without expensive headless browser overhead.

## Key Features
1. **Deep Structured Extraction**: Automatically normalizes every output record against a strict dataset schema.
2. **Plug-and-Play API & Webhook Integration**: Call directly via `POST https://api.apify.com/v2/acts/huynguyen-data-cloud~b2b-contact-social-enricher/run-sync-get-dataset-items`.
3. **Built-in Data Hygiene**: Deduplicates records, filters false positives, and computes actionable scoring metrics.

## Quick Start (cURL / API)
```bash
curl -X POST "https://api.apify.com/v2/acts/huynguyen-data-cloud~b2b-contact-social-enricher/run-sync-get-dataset-items?token=YOUR_APIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"startUrls": [{"url": "https://apify.com"}], "crawlSubpages": true, "maxSubpagesPerDomain": 5}'
```
