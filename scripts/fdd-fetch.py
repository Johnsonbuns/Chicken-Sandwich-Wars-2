#!/usr/bin/env python3
"""
Search Minnesota CARDS for franchise filings and download the FDDs.

    python3 scripts/fdd-fetch.py --list "Zaxby"
    python3 scripts/fdd-fetch.py --list "Zaxby" --year 2025
    python3 scripts/fdd-fetch.py --get  "Zaxby" --year 2025 --out research/fdd/

Minnesota is one of the states that requires franchisors to file, and unlike Wisconsin it
publishes whole documents. `Marked FDD` is the disclosure document itself; the other
document types on a filing (Application/Form A, Cover letter, Deficiency Notice, Order
Amending Registration) are the registration paperwork around it.

TWO THINGS THAT COST THIS PROJECT MONTHS, BOTH TRIVIAL:

1. The host is `www.cards.commerce.state.mn.us`. Without the `www.` it is NXDOMAIN — not
   a 403, not a block, just a name that does not exist. CLAUDE.md recorded it as
   "returns 403 from this environment" and then as proxy-denied, and on that basis five
   AUVs sat overdue for twenty months and were written up as unobtainable. They were
   always one subdomain away.

2. Download URLs embed a GUID in literal curly braces. Sent raw they return 400; percent-
   encode them to %7B/%7D and the same URL returns the PDF.

CARDS lags the state registration dates. A franchisor whose newest Wisconsin registration
is dated 2026-04 may still only have its 2025 edition here — that is normal, and the older
edition is still the primary source for its own fiscal year. Check what is actually
returned rather than assuming the newest exists.
"""
import argparse, html, os, re, sys, urllib.parse, urllib.request

BASE = 'https://www.cards.commerce.state.mn.us'
SEARCH = BASE + '/franchise-registrations'
UA = ('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) '
      'Chrome/120 Safari/537.36 CSW-research/1.0')


def fetch(url, timeout=180):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(), r.headers.get('Content-Type', '')


def search(name=None, franchisor=None, year=None, doctype=None):
    q = {'doSearch': 'true'}
    if name:       q['franchiseName'] = name
    if franchisor: q['franchisor'] = franchisor
    if year:       q['year'] = str(year)
    if doctype:    q['documentType'] = doctype
    body, _ = fetch(SEARCH + '?' + urllib.parse.urlencode(q))
    page = body.decode('utf-8', 'replace')
    if 'No documents found' in page:
        return []
    out, seen = [], set()
    for tr in re.findall(r'<tr[^>]*>(.*?)</tr>', page, re.S):
        # The row-number cell is a <th>, not a <td>; matching only <td> shifts every
        # column by one and silently mislabels the whole result set.
        cells = [html.unescape(re.sub(r'<[^>]+>', ' ', c)) for c in
                 re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', tr, re.S)]
        cells = [re.sub(r'\s+', ' ', c).strip() for c in cells]
        href = re.search(r'href="([^"]*?/documents/[^"]+)"', tr)
        if not href or len(cells) < 7:
            continue
        url = html.unescape(href.group(1))
        # The GUID arrives in literal braces; unencoded it is a 400.
        url = url.replace('{', '%7B').replace('}', '%7D')
        rec = {'doc': cells[1], 'franchisor': cells[2], 'brands': cells[3],
               'type': cells[4], 'year': cells[5], 'file_no': cells[6], 'url': url}
        key = (rec['doc'], rec['type'], rec['year'])
        if key in seen:            # CARDS repeats a filing once per associated brand name
            continue
        seen.add(key)
        out.append(rec)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--list'); ap.add_argument('--get')
    ap.add_argument('--franchisor'); ap.add_argument('--year')
    ap.add_argument('--type', default='Marked FDD',
                    help='document type to download with --get (default: Marked FDD)')
    ap.add_argument('--out', default='research/fdd')
    a = ap.parse_args()

    term = a.list or a.get
    if not term and not a.franchisor:
        sys.exit(__doc__)

    rows = search(term, a.franchisor, a.year)
    if not rows:
        print('no documents found'); return

    if a.list or not a.get:
        print(f'{len(rows)} filing(s)\n')
        for r in rows:
            print(f"  {r['year']}  {r['type']:<28} {r['franchisor'][:44]:<44} file {r['file_no']}")
        types = sorted({r['type'] for r in rows})
        print('\ndocument types present:', ', '.join(types))
        return

    want = [r for r in rows if r['type'].lower() == a.type.lower()]
    if not want:
        print(f"no '{a.type}' among: " + ', '.join(sorted({r['type'] for r in rows})))
        return
    os.makedirs(a.out, exist_ok=True)
    for r in want:
        slug = re.sub(r'[^a-z0-9]+', '-', r['franchisor'].lower()).strip('-')[:40]
        dest = os.path.join(a.out, f"{slug}-{r['year']}-{r['doc']}.pdf")
        if os.path.exists(dest):
            print('have', dest); continue
        body, ctype = fetch(BASE + r['url'])
        if 'pdf' not in ctype.lower():
            print(f"  !! {r['doc']} returned {ctype}, not a PDF"); continue
        open(dest, 'wb').write(body)
        print(f"  {dest}  {len(body)//1024} KB")


if __name__ == '__main__':
    main()
