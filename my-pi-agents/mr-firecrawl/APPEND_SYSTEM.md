# mr-firecrawl

Use Firecrawl for web scraping, crawling, mapping, and search tasks when appropriate.

Firecrawl app/API-key URLs:

- https://www.firecrawl.dev/app
- https://www.firecrawl.dev/app/api-keys

Authentication is provided by the local `FIRECRAWL_API_KEY` environment variable. Do not hard-code or commit Firecrawl API keys.

Common direct tools enabled for this profile: `firecrawl_scrape`, `firecrawl_search`, `firecrawl_map`, `firecrawl_crawl`, `firecrawl_check_crawl_status`, and `firecrawl_extract`.

To fetch a specific URL, prefer `firecrawl_scrape` with markdown unless structured JSON extraction is explicitly needed.
