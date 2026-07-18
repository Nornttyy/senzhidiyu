#!/usr/bin/env python3
"""外科抹除与主体相连的残渣（地影/画上光晕等）——先标注人工确认，再按簇号精确切除。

流程（playbook 规则 4：禁止盲切）:
    1. annotate: 按谓词（低饱和 + 亮度带）聚类候选像素，输出红色叠加标注图与簇表
    2. excise:   人工确认簇号后精确抹除，全图 alpha 轻羽化，打印差异审计（改动像素数/包围盒）

用法:
    python3 tools/excise_residue.py annotate <img> <标注图.png> [--sat 32] [--lum-min 120] [--lum-max 235] [--min-size 80]
    python3 tools/excise_residue.py excise   <img> <输出.png>   --ids 1,3 [同上谓词参数]
"""
import argparse
import sys
from collections import deque

from PIL import Image, ImageFilter


def clusters(im, sat_max, lum_min, lum_max, min_size):
    w, h = im.size
    px = im.load()
    a = im.getchannel("A").load()

    def cand(x, y):
        if a[x, y] <= 8:
            return False
        r, g, b = px[x, y][:3]
        lum = (r + g + b) // 3
        return (max(r, g, b) - min(r, g, b)) <= sat_max and lum_min <= lum <= lum_max

    seen = bytearray(w * h)
    out = []
    for sy in range(h):
        for sx in range(w):
            if seen[sy * w + sx] or not cand(sx, sy):
                continue
            comp = []
            seen[sy * w + sx] = 1
            q = deque([(sx, sy)])
            while q:
                x, y = q.popleft()
                comp.append((x, y))
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx] and cand(nx, ny):
                        seen[ny * w + nx] = 1
                        q.append((nx, ny))
            if len(comp) >= min_size:
                out.append(comp)
    out.sort(key=len, reverse=True)
    return out


def main():
    p = argparse.ArgumentParser()
    p.add_argument("cmd", choices=["annotate", "excise"])
    p.add_argument("src")
    p.add_argument("dst")
    p.add_argument("--ids", default="")
    p.add_argument("--sat", type=int, default=32)
    p.add_argument("--lum-min", type=int, default=120)
    p.add_argument("--lum-max", type=int, default=235)
    p.add_argument("--min-size", type=int, default=80)
    args = p.parse_args()

    im = Image.open(args.src).convert("RGBA")
    comps = clusters(im, args.sat, args.lum_min, args.lum_max, args.min_size)
    for i, c in enumerate(comps[:15], 1):
        xs = [x for x, _ in c]
        ys = [y for _, y in c]
        print(f"簇{i}: size={len(c)} bbox=({min(xs)},{min(ys)})-({max(xs)},{max(ys)})")

    if args.cmd == "annotate":
        night = Image.new("RGBA", im.size, (16, 22, 18, 255))
        night.alpha_composite(im)
        px = night.load()
        for i, c in enumerate(comps[:15], 1):
            tint = (255, 60, 60) if i % 2 else (255, 160, 40)  # 相邻簇换色便于区分
            for x, y in c:
                r, g, b, _ = px[x, y]
                px[x, y] = ((r + tint[0]) // 2, (g + tint[1]) // 2, (b + tint[2]) // 2, 255)
        night.convert("RGB").save(args.dst)
        print(f"标注图 -> {args.dst}")
        return

    ids = {int(s) for s in args.ids.split(",") if s}
    if not ids:
        sys.exit("excise 需要 --ids")
    before = im.getchannel("A")
    alpha = before.load()
    erased = 0
    xs_all, ys_all = [], []
    for i, c in enumerate(comps[:15], 1):
        if i not in ids:
            continue
        for x, y in c:
            alpha[x, y] = 0
            erased += 1
            xs_all.append(x)
            ys_all.append(y)
    a2 = im.getchannel("A").filter(ImageFilter.GaussianBlur(1))  # 切口羽化
    im.putalpha(a2)
    im.save(args.dst)
    diff = sum(
        1 for yy in range(im.height) for xx in range(im.width)
        if abs(a2.load()[xx, yy] - before.load()[xx, yy]) > 12
    )
    print(f"抹除簇 {sorted(ids)}: 直接抹 {erased}px, 羽化后显著改动 {diff}px, "
          f"改动包围盒=({min(xs_all)},{min(ys_all)})-({max(xs_all)},{max(ys_all)})")


if __name__ == "__main__":
    main()
