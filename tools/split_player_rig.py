#!/usr/bin/env python3
"""把 3×2 的角色骨骼零件表切成六张紧凑透明 PNG。"""

import argparse
from pathlib import Path

from PIL import Image


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("src", help="已经抠除背景的 3×2 零件表")
    parser.add_argument("out_dir", help="输出文件夹")
    parser.add_argument("--prefix", default="seeker-side")
    parser.add_argument("--padding", type=int, default=8)
    args = parser.parse_args()

    sheet = Image.open(args.src).convert("RGBA")
    col_1 = sheet.width // 3
    col_2 = sheet.width * 2 // 3
    mid_y = sheet.height // 2
    # 上排的头巾略伸过数学三等分线，因此在纯背景空隙中使用可重叠的自定义边界。
    head_right = round(sheet.width * 0.42)
    body_left = round(sheet.width * 0.40)
    body_right = round(sheet.width * 0.70)
    cells = {
        "head": (0, 0, head_right, mid_y),
        "body": (body_left, 0, body_right, mid_y),
        "upper-arm": (body_right, 0, sheet.width, mid_y),
        "lower-arm": (0, mid_y, col_1, sheet.height),
        "upper-leg": (col_1, mid_y, col_2, sheet.height),
        "lower-leg": (col_2, mid_y, sheet.width, sheet.height),
    }

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, box in cells.items():
        cell = sheet.crop(box)
        alpha_box = cell.getchannel("A").getbbox()
        if alpha_box is None:
            raise SystemExit(f"{name} 单元格没有找到非透明像素")
        left, top, right, bottom = alpha_box
        left = max(0, left - args.padding)
        top = max(0, top - args.padding)
        right = min(cell.width, right + args.padding)
        bottom = min(cell.height, bottom + args.padding)
        part = cell.crop((left, top, right, bottom))
        dst = out_dir / f"{args.prefix}-{name}.png"
        part.save(dst, optimize=True)
        print(f"{name}: {part.width}×{part.height} -> {dst}")


if __name__ == "__main__":
    main()
