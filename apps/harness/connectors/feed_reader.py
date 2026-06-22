"""
Feed Reader — smart URL resolver + feedparser wrapper.

Handles: RSS/Atom URLs, website auto-discovery, YouTube channels,
Reddit subreddits, Google News topics/search queries.
"""

import logging
import re
import html
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlparse, quote_plus

log = logging.getLogger(__name__)

# ── Preset packs ─────────────────────────────────────────────────────────────
# Used as empty-state onboarding: click a category to seed your feed list.
# source_type values: "rss" | "youtube" | "reddit"

PRESET_PACKS: dict[str, list[dict]] = {
    "ai_tech": {
        "label": "AI & Tech",
        "icon": "Cpu",
        "feeds": [
            {"name": "Hacker News", "url": "https://news.ycombinator.com/rss", "source_type": "rss"},
            {"name": "Ars Technica", "url": "https://feeds.arstechnica.com/arstechnica/index", "source_type": "rss"},
            {"name": "The Verge", "url": "https://www.theverge.com/rss/index.xml", "source_type": "rss"},
            {"name": "MIT Technology Review", "url": "https://www.technologyreview.com/feed/", "source_type": "rss"},
            {"name": "Simon Willison's Blog", "url": "https://simonwillison.net/atom/everything/", "source_type": "rss"},
            {"name": "Anthropic News", "url": "https://www.anthropic.com/news.rss", "source_type": "rss"},
            {"name": "r/MachineLearning", "url": "https://www.reddit.com/r/MachineLearning.rss", "source_type": "reddit"},
            {"name": "r/LocalLLaMA", "url": "https://www.reddit.com/r/LocalLLaMA.rss", "source_type": "reddit"},
        ],
    },
    "digital_marketing": {
        "label": "Digital Marketing",
        "icon": "TrendingUp",
        "feeds": [
            {"name": "Search Engine Journal", "url": "https://www.searchenginejournal.com/feed/", "source_type": "rss"},
            {"name": "Moz Blog", "url": "https://moz.com/blog/feed", "source_type": "rss"},
            {"name": "Search Engine Land", "url": "https://searchengineland.com/feed", "source_type": "rss"},
            {"name": "HubSpot Marketing", "url": "https://blog.hubspot.com/marketing/rss.xml", "source_type": "rss"},
            {"name": "Neil Patel Blog", "url": "https://neilpatel.com/blog/feed/", "source_type": "rss"},
            {"name": "r/digital_marketing", "url": "https://www.reddit.com/r/digital_marketing.rss", "source_type": "reddit"},
        ],
    },
    "cycling": {
        "label": "Cycling",
        "icon": "Bike",
        "feeds": [
            {"name": "VeloNews", "url": "https://www.velonews.com/feed/", "source_type": "rss"},
            {"name": "Cycling Weekly", "url": "https://www.cyclingweekly.com/feed", "source_type": "rss"},
            {"name": "Road.cc", "url": "https://road.cc/rss.xml", "source_type": "rss"},
            {"name": "DC Rainmaker", "url": "https://www.dcrainmaker.com/feed", "source_type": "rss"},
            {"name": "r/cycling", "url": "https://www.reddit.com/r/cycling.rss", "source_type": "reddit"},
            {"name": "r/randonneuring", "url": "https://www.reddit.com/r/randonneuring.rss", "source_type": "reddit"},
        ],
    },
    "business": {
        "label": "Business",
        "icon": "Briefcase",
        "feeds": [
            {"name": "Harvard Business Review", "url": "https://feeds.hbr.org/harvardbusiness", "source_type": "rss"},
            {"name": "Inc. Magazine", "url": "https://www.inc.com/rss/", "source_type": "rss"},
            {"name": "Fast Company", "url": "https://www.fastcompany.com/latest/rss", "source_type": "rss"},
            {"name": "a16z Blog", "url": "https://a16z.com/feed/", "source_type": "rss"},
        ],
    },
    "philippines": {
        "label": "Philippines",
        "icon": "Globe",
        "feeds": [
            {"name": "Rappler", "url": "https://www.rappler.com/feed/", "source_type": "rss"},
            {"name": "Philippine Daily Inquirer", "url": "https://business.inquirer.net/feed", "source_type": "rss"},
            {"name": "BusinessMirror", "url": "https://businessmirror.com.ph/feed/", "source_type": "rss"},
            {"name": "CNN Philippines", "url": "https://www.cnnphilippines.com/rss/", "source_type": "rss"},
        ],
    },
    "design": {
        "label": "Design",
        "icon": "Palette",
        "feeds": [
            {"name": "UX Collective", "url": "https://uxdesign.cc/feed", "source_type": "rss"},
            {"name": "Smashing Magazine", "url": "https://www.smashingmagazine.com/feed/", "source_type": "rss"},
            {"name": "CSS-Tricks", "url": "https://css-tricks.com/feed/", "source_type": "rss"},
            {"name": "r/web_design", "url": "https://www.reddit.com/r/web_design.rss", "source_type": "reddit"},
        ],
    },
}


# ── URL resolver ──────────────────────────────────────────────────────────────

def resolve_feed_url(input_url: str) -> tuple[str, str]:
    """
    Convert any URL to a (feed_url, source_type) pair.
    Raises ValueError if no feed can be found.
    """
    input_url = input_url.strip()
    parsed = urlparse(input_url)
    hostname = parsed.hostname or ""

    # YouTube channel/user URL
    if "youtube.com" in hostname or "youtu.be" in hostname:
        channel_id = _extract_youtube_channel_id(input_url)
        if channel_id:
            return f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}", "youtube"
        raise ValueError(f"Could not extract YouTube channel ID from: {input_url}")

    # Reddit subreddit
    if "reddit.com" in hostname:
        # Normalize to .rss
        path = parsed.path.rstrip("/")
        if not path.endswith(".rss"):
            path = path + ".rss"
        return f"https://www.reddit.com{path}", "reddit"

    # Google News search or topic
    if "news.google.com" in hostname:
        return input_url, "google_news"

    # Plain search query for Google News (not a URL)
    # If caller passes e.g. "google:digital marketing" we build the feed URL
    if input_url.lower().startswith("google:"):
        query = input_url[7:].strip()
        return f"https://news.google.com/rss/search?q={quote_plus(query)}&hl=en&gl=PH&ceid=PH:en", "google_news"

    # Try to parse directly as RSS/Atom (fast path)
    try:
        import feedparser
        d = feedparser.parse(input_url)
        if d.entries or d.feed.get("title"):
            return input_url, "rss"
    except Exception:
        pass

    # Website — auto-discover feed via <link rel="alternate">
    feed_url = _discover_feed_from_website(input_url)
    if feed_url:
        return feed_url, "website"

    raise ValueError(
        f"No RSS/Atom feed found at '{input_url}'. "
        "Try pasting the direct feed URL instead."
    )


def _extract_youtube_channel_id(url: str) -> Optional[str]:
    """Extract YouTube channel_id from various YouTube URL formats."""
    import re
    # Direct channel ID: /channel/UCxxxxx
    m = re.search(r"/channel/(UC[\w-]+)", url)
    if m:
        return m.group(1)

    # @handle or /c/ or /user/ — need to fetch the page and extract from HTML
    try:
        import urllib.request
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            html_content = resp.read(200_000).decode("utf-8", errors="ignore")
        m = re.search(r'"channelId"\s*:\s*"(UC[\w-]+)"', html_content)
        if m:
            return m.group(1)
        m = re.search(r'channel/(UC[\w-]+)', html_content)
        if m:
            return m.group(1)
    except Exception as e:
        log.debug("YouTube channel ID extraction failed: %s", e)
    return None


def _discover_feed_from_website(url: str) -> Optional[str]:
    """Scrape a website's <link rel='alternate'> to find its RSS/Atom feed."""
    try:
        import urllib.request
        from urllib.parse import urljoin
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            html_content = resp.read(100_000).decode("utf-8", errors="ignore")
            base_url = resp.url  # follow redirects

        # Find <link type="application/rss+xml"> or <link type="application/atom+xml">
        pattern = re.compile(
            r'<link[^>]+type=["\']application/(rss|atom)\+xml["\'][^>]*href=["\']([^"\']+)["\']',
            re.IGNORECASE,
        )
        matches = pattern.findall(html_content)
        if not matches:
            # reversed attribute order
            pattern2 = re.compile(
                r'<link[^>]+href=["\']([^"\']+)["\'][^>]+type=["\']application/(rss|atom)\+xml["\']',
                re.IGNORECASE,
            )
            matches2 = pattern2.findall(html_content)
            if matches2:
                return urljoin(base_url, matches2[0][0])
        if matches:
            return urljoin(base_url, matches[0][1])
    except Exception as e:
        log.debug("Feed discovery failed for %s: %s", url, e)
    return None


# ── Feed parser ───────────────────────────────────────────────────────────────

def _detect_media_type(entry: dict, source_type: str) -> tuple[str, Optional[str]]:
    """
    Returns (media_type, media_url).
    media_type: "article" | "video" | "podcast" | "link"
    media_url: YouTube embed URL, podcast audio URL, or None
    """
    if source_type == "youtube":
        # Extract video ID from the entry link
        link = entry.get("link", "")
        m = re.search(r"(?:v=|youtu\.be/)([A-Za-z0-9_-]{11})", link)
        if m:
            return "video", f"https://www.youtube.com/embed/{m.group(1)}"
        return "video", None

    if source_type == "reddit":
        return "link", None

    # Check for podcast enclosure (audio attachment)
    enclosures = entry.get("enclosures", [])
    for enc in enclosures:
        mime = enc.get("type", "")
        if "audio" in mime:
            return "podcast", enc.get("href") or enc.get("url")

    # If entry has no meaningful text content, treat as link
    summary = entry.get("summary", "") or ""
    content_list = entry.get("content", [])
    content = content_list[0].get("value", "") if content_list else ""
    if not summary and not content:
        return "link", None

    return "article", None


def _clean_html(text: str) -> str:
    """Strip HTML tags and decode entities for plain-text excerpt."""
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _parse_date(entry: dict) -> Optional[datetime]:
    """Parse published/updated date from feedparser entry."""
    import time
    for field in ("published_parsed", "updated_parsed", "created_parsed"):
        t = entry.get(field)
        if t:
            try:
                return datetime.fromtimestamp(time.mktime(t), tz=timezone.utc)
            except Exception:
                pass
    return None


def fetch_feed(feed_url: str, source_type: str = "rss", since: Optional[datetime] = None) -> list[dict]:
    """
    Fetch and parse a feed URL. Returns list of item dicts ready for DB insert.
    Filters to entries published after `since` if provided.
    """
    import feedparser
    d = feedparser.parse(feed_url)

    # Get feed-level favicon
    favicon_url = None
    if d.feed.get("image"):
        favicon_url = d.feed.image.get("href") or d.feed.image.get("url")

    items = []
    for entry in d.entries:
        published_at = _parse_date(entry)

        # Skip old items when doing incremental sync
        if since and published_at and published_at <= since:
            continue

        title = _clean_html(entry.get("title", "Untitled"))
        url = entry.get("link", "")
        if not url:
            continue

        author = entry.get("author", "") or ""

        # Content: prefer full content over summary
        content_list = entry.get("content", [])
        raw_content = content_list[0].get("value", "") if content_list else ""
        raw_summary = entry.get("summary", "") or ""
        content = raw_content or raw_summary

        clean_summary = _clean_html(raw_summary or raw_content)[:500]

        # Image: look in media_content or enclosures
        image_url = None
        for mc in entry.get("media_content", []):
            if mc.get("medium") == "image" or (mc.get("type", "").startswith("image")):
                image_url = mc.get("url")
                break
        if not image_url:
            for enc in entry.get("enclosures", []):
                if enc.get("type", "").startswith("image"):
                    image_url = enc.get("href") or enc.get("url")
                    break

        media_type, media_url = _detect_media_type(entry, source_type)

        items.append({
            "title": title,
            "url": url,
            "author": author,
            "summary": clean_summary,
            "content": content,
            "image_url": image_url,
            "published_at": published_at,
            "media_type": media_type,
            "media_url": media_url,
        })

    return items, favicon_url


def preview_feed(input_url: str) -> dict:
    """
    Resolve + fetch a feed for preview (used by AddFeedModal before saving).
    Returns {name, feed_url, source_type, favicon_url, items[3]}.
    """
    import feedparser
    feed_url, source_type = resolve_feed_url(input_url)
    d = feedparser.parse(feed_url)

    name = d.feed.get("title") or urlparse(feed_url).hostname or feed_url
    favicon_url = None
    if d.feed.get("image"):
        favicon_url = d.feed.image.get("href") or d.feed.image.get("url")

    preview_items = []
    for entry in d.entries[:3]:
        preview_items.append({
            "title": _clean_html(entry.get("title", "Untitled")),
            "url": entry.get("link", ""),
            "published_at": _parse_date(entry).isoformat() if _parse_date(entry) else None,
        })

    return {
        "name": name,
        "feed_url": feed_url,
        "source_type": source_type,
        "favicon_url": favicon_url,
        "items": preview_items,
    }
