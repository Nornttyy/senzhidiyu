#!/usr/bin/env python3
"""清除正面待机角色脚边的生成式地面阴影，保留两只靴子。"""

import argparse
from pathlib import Path

from PIL import Image


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("src")
    parser.add_argument("dst")
    parser.add_argument("--shadow-start", type=int, default=909)
    parser.add_argument("--foot-line", type=int, default=940)
    args = parser.parse_args()

    image = Image.open(args.src).convert("RGBA")
    pixels = image.load()
    removed = 0
    # 这一行开始，非透明像素宽度会从双脚宽度突然扩成横线；全部清除最可靠。
    for y in range(args.shadow_start, image.height):
        for x in range(image.width):
            if pixels[x, y][3] != 0:
                pixels[x, y] = (0, 0, 0, 0)
                removed += 1

    # 两只靴子之间还夹着一条很细的灰白线，单独清掉中央空隙。
    for y in range(895, args.shadow_start):
        for x in range(330, 390):
            if pixels[x, y][3] != 0:
                pixels[x, y] = (0, 0, 0, 0)
                removed += 1

    # 清阴影后把真正的靴底移回统一脚底线，避免角色看起来浮在空中。
    shift_y = args.foot_line - (args.shadow_start - 1)
    shifted = Image.new("RGBA", image.size, (0, 0, 0, 0))
    shifted.alpha_composite(image, (0, shift_y))

    Path(args.dst).parent.mkdir(parents=True, exist_ok=True)
    shifted.save(args.dst, optimize=True)
    print(f"清除阴影像素 {removed} 个，角色下移 {shift_y}px -> {args.dst}")


if __name__ == "__main__":
    main()
