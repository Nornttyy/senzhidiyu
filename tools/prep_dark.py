#!/usr/bin/env python3
"""黑底素材预处理：把 AI 生成的暗底发光图压成纯黑底，供游戏内加法/滤色混合。

用法:
    python3 tools/prep_dark.py assets/raw/phantom-01.png assets/processed/phantom.png \
        [--crop-bottom 1190] [--floor auto] [--game-scale 0.1] [--preview out.png]

原理:
    1. 可选先裁掉底部水印条（浅色水印在加法混合下会发光，必须去除）
    2. 从边框条带采样底色分布，每通道取高分位作地板值，线性压底：
       低于地板 -> 0，其余重映射，水彩底的暗灰斑驳全部归零
    3. 按内容裁切留边距，输出 RGB（加法混合不需要 alpha，黑即透明）
    4. 可选输出加法混合到夜色底上的预览图（含游戏内近似缩放）
"""
import argparse
from collections import deque

from PIL import Image


def corner_floor(px, w, h, patch=80, q=0.999, pad=4):
    """四角方块每通道高分位 + 余量，作为压底地板值。
    只采角落：居中构图的主体（含下垂雾尾）不会进入采样区。"""
    samples = [[], [], []]
    for cx, cy in ((0, 0), (w - patch, 0), (0, h - patch), (w - patch, h - patch)):
        for x in range(cx, cx + patch):
            for y in range(cy, cy + patch):
                for c in range(3):
                    samples[c].append(px[x, y][c])
    floors = []
    for c in range(3):
        v = sorted(samples[c])
        floors.append(min(255, v[int(len(v) * q)] + pad))
    return floors


def keep_glowing(im, hi=70, min_strong=200):
    """滞回连通过滤：只保留含有足量亮核像素（≥hi）的非零连通块。
    压底后残留的水彩底灰斑没有亮核，整块归零；带亮核的独立雾团保留。"""
    w, h = im.size
    px = im.load()
    lum = bytearray(max(px[x, y]) for y in range(h) for x in range(w))
    seen = bytearray(w * h)
    kept = bytearray(w * h)
    dropped = kept_n = 0
    for start in range(w * h):
        if lum[start] == 0 or seen[start]:
            continue
        comp = [start]
        strong = 1 if lum[start] >= hi else 0
        seen[start] = 1
        q = deque([start])
        while q:
            i = q.popleft()
            x, y = i % w, i // w
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if 0 <= nx < w and 0 <= ny < h:
                    ni = ny * w + nx
                    if lum[ni] and not seen[ni]:
                        seen[ni] = 1
                        comp.append(ni)
                        if lum[ni] >= hi:
                            strong += 1
                        q.append(ni)
        if strong >= min_strong:
            kept_n += 1
            for i in comp:
                kept[i] = 1
        else:
            dropped += 1
    for y in range(h):
        for x in range(w):
            if not kept[y * w + x]:
                px[x, y] = (0, 0, 0)
    print(f"连通过滤: 保留 {kept_n} 团，剔除 {dropped} 块灰斑")
    return im


def prep(src, dst, crop_bottom=None, floor="auto", game_scale=0.1, preview=None, margin=8):
    im = Image.open(src).convert("RGB")
    if crop_bottom:
        im = im.crop((0, 0, im.width, crop_bottom))
    w, h = im.size
    px = im.load()

    if floor == "auto":
        floors = corner_floor(px, w, h)
    else:
        floors = [int(floor)] * 3
    print(f"压底地板值 RGB={floors}")

    luts = []
    for lo in floors:
        scale = 255.0 / (255 - lo) if lo < 255 else 0
        luts.append([max(0, min(255, round((v - lo) * scale))) for v in range(256)])
    im = Image.merge("RGB", [ch.point(lut) for ch, lut in zip(im.split(), luts)])
    im = keep_glowing(im)

    bbox = im.getbbox()  # RGB 全零即黑，等价于内容框
    if not bbox:
        raise SystemExit(f"{src}: 压底后没有内容，检查 --floor")
    bbox = (max(0, bbox[0] - margin), max(0, bbox[1] - margin),
            min(w, bbox[2] + margin), min(h, bbox[3] + margin))
    im = im.crop(bbox)
    im.save(dst)
    print(f"{src} -> {dst}  尺寸={im.size}")

    if preview:
        night = (16, 22, 18)
        small = im.resize((max(1, int(im.width * game_scale)),
                           max(1, int(im.height * game_scale))), Image.LANCZOS)
        canvas = Image.new("RGB", (im.width + small.width + 120, im.height + 80), night)
        for tile, ox, oy in ((im, 40, 40), (small, im.width + 80, 40 + im.height - small.height)):
            # 加法混合：result = base + tile
            base = canvas.crop((ox, oy, ox + tile.width, oy + tile.height))
            tp = tile.load()
            bp = base.load()
            out = Image.new("RGB", tile.size)
            op = out.load()
            for y in range(tile.height):
                for x in range(tile.width):
                    op[x, y] = tuple(min(255, bp[x, y][c] + tp[x, y][c]) for c in range(3))
            canvas.paste(out, (ox, oy))
        canvas.save(preview)
        print(f"预览 -> {preview}（加法混合合成，右侧为游戏内近似缩放）")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("src")
    p.add_argument("dst")
    p.add_argument("--crop-bottom", type=int, help="先裁掉此 y 坐标以下的水印条")
    p.add_argument("--floor", default="auto", help="压底地板值，auto=边框采样")
    p.add_argument("--game-scale", type=float, default=0.1)
    p.add_argument("--preview")
    args = p.parse_args()
    prep(args.src, args.dst, args.crop_bottom, args.floor, args.game_scale, args.preview)
