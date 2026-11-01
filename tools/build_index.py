#!/usr/bin/env python3
"""Build content/search-index.json and update word counts in content/curriculum.json.

Run after editing any chapter:  python3 tools/build_index.py
No dependencies beyond the standard library."""
import json, re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"

def slugify(s):
    s = re.sub(r"<[^>]+>", "", s.lower())
    s = re.sub(r"&[a-z]+;", "", s)
    s = re.sub(r"[^a-z0-9\s-]", "", s).strip()
    s = re.sub(r"\s+", "-", s)
    return re.sub(r"-+", "-", s)[:80]

def clean(text):
    # Drop fenced component blocks' JSON noise but keep code text (useful for searching commands).
    out = []
    for i, seg in enumerate(re.split(r"(```[\s\S]*?```)", text)):
        if i % 2 == 1:
            first = seg.split("\n", 1)[0]
            lang = first.strip("`").strip().split(" ")[0]
            body = seg.split("\n", 1)[1] if "\n" in seg else ""
            body = body.rsplit("```", 1)[0]
            if lang in ("quiz", "diagram", "flow", "layers", "scenario", "compare") or lang.startswith("widget:"):
                # extract human-readable strings from JSON
                strings = re.findall(r'"(?:[^"\\]|\\.)*"', body)
                body = " ".join(s.strip('"') for s in strings if len(s) > 6)
            out.append(" " + body + " ")
        else:
            seg = re.sub(r"^:::\w+.*$", "", seg, flags=re.M)
            seg = re.sub(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]", lambda m: m.group(2) or m.group(1), seg)
            seg = re.sub(r"<[^>]+>", " ", seg)
            seg = re.sub(r"[*_`>#|]", " ", seg)
            seg = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", seg)
            out.append(seg)
    return re.sub(r"\s+", " ", "".join(out)).strip()

def main():
    cur = json.loads((CONTENT / "curriculum.json").read_text())
    index = []
    total_words = 0
    missing = []
    for part in cur["parts"]:
        for ch in part["chapters"]:
            path = CONTENT / part["id"] / f"{ch['id']}.md"
            cid = f"{part['id']}/{ch['id']}"
            if not path.exists():
                missing.append(cid); continue
            md = path.read_text()
            md = re.sub(r"^#\s+[^\n]+\n", "", md)
            total_words += len(md.split())
            # split by headings (## / ###) outside code fences
            sections = []
            cur_h, cur_slug, buf, used = None, "", [], {}
            in_code = False
            for line in md.split("\n"):
                if line.startswith("```"):
                    in_code = not in_code
                m = re.match(r"^(#{2,3})\s+(.+)$", line) if not in_code else None
                if m:
                    sections.append((cur_h, cur_slug, "\n".join(buf)))
                    cur_h = re.sub(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]", lambda mm: mm.group(2) or mm.group(1), m.group(2).strip())
                    cur_h = re.sub(r"`", "", cur_h)
                    s = slugify(cur_h) or "section"
                    if s in used:
                        used[s] += 1; s = f"{s}-{used[s]}"
                    else:
                        used[s] = 1
                    cur_slug = s; buf = []
                else:
                    buf.append(line)
            sections.append((cur_h, cur_slug, "\n".join(buf)))
            for h, s, body in sections:
                text = clean(body)
                if not text and not h:
                    continue
                index.append({"c": cid, "pt": f"Part {part['num']}", "t": ch["title"], "h": h or "", "s": s if h else "", "x": text[:1500]})
    cur.setdefault("stats", {})["words"] = total_words
    cur["stats"]["chapters"] = sum(len(p["chapters"]) for p in cur["parts"])
    (CONTENT / "search-index.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")))
    (CONTENT / "curriculum.json").write_text(json.dumps(cur, ensure_ascii=False, indent=2) + "\n")
    print(f"indexed {len(index)} sections, {total_words} words, {cur['stats']['chapters']} chapters")
    if missing:
        print(f"missing {len(missing)} chapter files:", ", ".join(missing))
        return 1 if "--strict" in sys.argv else 0
    return 0

if __name__ == "__main__":
    sys.exit(main())
