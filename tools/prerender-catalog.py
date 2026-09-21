#!/usr/bin/env python3
"""Bake the live Supabase catalog into product/index.html as static HTML + Product schema.

The catalog is normally fetched client-side, which means crawlers that don't run
JavaScript (most AI crawlers do not) see an empty grid. This writes a snapshot
into two marked regions of the page:

    <!-- CATALOG:START -->        real product cards, replaced by JS for real users
    <!-- CATALOG-SCHEMA:START --> one schema.org Product per item, inside an ItemList

Re-run after adding, removing or editing products in the admin panel:

    python tools/prerender-catalog.py

Stale snapshots are worse than none for entity confidence, so keep it current.
"""

import html
import json
import re
import sys
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

SUPABASE_URL = "https://ceeezhukizoobknroovq.supabase.co"
SUPABASE_KEY = "sb_publishable_3XHshryDBRniaiW5YEO03w_pUMH6gIG"  # public anon key, already in the page
SITE = "https://shahinterio.com"

PAGE = Path(__file__).resolve().parent.parent / "product" / "index.html"

CAT_LABELS = {
    "almirah-home": "Home Almirah",
    "almirah-office": "Office Almirah",
    "almirah-dressing": "Dressing Almirah",
    "locker": "Locker",
    "bookshelf": "BookShelf",
    "showcase": "Glass Showcase",
}
BADGE_CLASS = {"Bestseller": "badge-best", "New": "badge-new", "Hot": "badge-hot"}

MATERIAL = "CRCA cold-rolled steel with powder-coated, rust-resistant finish"


def fetch_products():
    url = f"{SUPABASE_URL}/rest/v1/products?select=*&order=created_at.desc"
    req = urllib.request.Request(url, headers={
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def open_view_src(closed, explicit_open):
    """Mirror the client-side convention: Foo.png -> Foo-Open.png."""
    if explicit_open:
        return explicit_open
    if not closed or closed.startswith("data:"):
        return None
    m = re.search(r"(\.[A-Za-z]+)$", closed)
    return closed[: -len(m.group(1))] + "-Open" + m.group(1) if m else None


def card_html(p, idx):
    e = html.escape
    title = p.get("title") or "Untitled"
    category = p.get("category") or ""
    label = CAT_LABELS.get(category, category)
    desc = p.get("description") or ""
    closed = p.get("image_closed") or ""
    opened = open_view_src(closed, p.get("image_open"))
    badge = p.get("badge") or ""
    features = p.get("features") if isinstance(p.get("features"), list) else []
    price = p.get("price_text") or "Factory Price"

    imgs = ""
    if closed:
        loading = "eager" if idx < 4 else "lazy"
        imgs += f'<img class="prod-img-closed" src="{e(closed)}" alt="{e(title)}" loading="{loading}">'
    if opened:
        imgs += f'<img class="prod-img-open" src="{e(opened)}" alt="{e(title)} – open view" aria-hidden="true" loading="lazy">'

    badge_html = (
        f'<div class="product-badge {BADGE_CLASS.get(badge, "")}">{e(badge)}</div>' if badge else ""
    )
    feat_html = "".join(f"<li>{e(f)}</li>" for f in features)

    # No-JS visitors get a working WhatsApp link where the JS button would be.
    wa = (
        "https://wa.me/919179539610?text="
        + urllib.parse.quote(
            f"Hello SECUREX Team!\n\nI am interested in *{title}*.\n"
            "Please share the price and bulk order details.\nThank you."
        )
    )

    return (
        f'<article class="product-card tilt{" has-open-img" if opened else ""}" '
        f'data-category="{e(category)}" style="animation-delay:{(idx % 12) * 0.05:.2f}s" aria-label="{e(title)}">'
        f'<div class="product-img">{imgs}{badge_html}</div>'
        f'<div class="product-info">'
        f'<div class="product-category">{e(label)}</div>'
        f'<h3 class="product-title">{e(title)}</h3>'
        f'<p class="product-desc">{e(desc)}</p>'
        f'<ul class="product-features">{feat_html}</ul>'
        f'<div class="product-footer">'
        f'<div class="product-price">{e(price)}<small>B2B Direct · MOQ Flexible</small></div>'
        f'<a class="product-enquiry" href="{e(wa)}" target="_blank" rel="noopener noreferrer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13"/><path d="m22 2-7 20-4-9-9-4Z"/></svg><span>Enquire</span></a>'
        f"</div></div></article>"
    )


def product_schema(p):
    title = p.get("title") or "Untitled"
    category = p.get("category") or ""
    node = {
        "@type": "Product",
        "@id": f"{SITE}/product/#product-{p.get('id')}",
        "name": title,
        "url": f"{SITE}/product/",
        "category": CAT_LABELS.get(category, category),
        "material": MATERIAL,
        "brand": {"@id": f"{SITE}/#brand"},
        "manufacturer": {"@id": f"{SITE}/#organization"},
    }
    if p.get("description"):
        node["description"] = p["description"]
    if p.get("image_closed"):
        images = [p["image_closed"]]
        opened = open_view_src(p["image_closed"], p.get("image_open"))
        if opened:
            images.append(opened)
        node["image"] = images
    feats = p.get("features") if isinstance(p.get("features"), list) else []
    if feats:
        node["additionalProperty"] = [
            {"@type": "PropertyValue", "name": "Feature", "value": f} for f in feats
        ]
    return node


def replace_region(text, start_marker, end_marker, body):
    pattern = re.compile(
        re.escape(start_marker) + r".*?" + re.escape(end_marker), re.DOTALL
    )
    if not pattern.search(text):
        sys.exit(f"Marker pair not found in {PAGE.name}: {start_marker}")
    return pattern.sub(lambda _: start_marker + body + end_marker, text, count=1)


def main():
    products = fetch_products()
    if not products:
        sys.exit("Supabase returned no products — refusing to write an empty snapshot.")

    cards = "\n".join(card_html(p, i) for i, p in enumerate(products))
    grid = (
        f"\n<!-- {len(products)} products, snapshot generated {date.today()} by "
        "tools/prerender-catalog.py. JavaScript replaces this with live data on load. -->\n"
        f"{cards}\n"
    )

    graph = {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "@id": f"{SITE}/product/#catalog",
        "name": "Securex Steel Furniture Catalog",
        "numberOfItems": len(products),
        "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "item": product_schema(p)}
            for i, p in enumerate(products)
        ],
    }
    schema = (
        '\n    <script type="application/ld+json">\n'
        + json.dumps(graph, indent=4, ensure_ascii=False)
        + "\n    </script>\n"
    )

    text = PAGE.read_text(encoding="utf-8")
    text = replace_region(text, "<!-- CATALOG:START -->", "<!-- CATALOG:END -->", grid)
    text = replace_region(text, "<!-- CATALOG-SCHEMA:START -->", "<!-- CATALOG-SCHEMA:END -->", schema)

    # Keep the visible count honest before JS runs.
    text = re.sub(
        r'(<span id="productCount">)\d+(</span>)', rf"\g<1>{len(products)}\g<2>", text, count=1
    )

    PAGE.write_text(text, encoding="utf-8")
    print(f"Prerendered {len(products)} products into {PAGE}")


if __name__ == "__main__":
    main()
