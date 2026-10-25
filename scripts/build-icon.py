"""Turn the supplied Pilot cat artwork into a square Windows app icon."""

from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
art = Image.open(root / "artwork" / "pilot-cat.png").convert("RGBA")
# Keep the hood, all three eyes and the controller readable at taskbar size.
square = art.crop((55, 0, 1165, 1110)).resize((1024, 1024), Image.Resampling.LANCZOS)
square.resize((256, 256), Image.Resampling.LANCZOS).save(root / "assets" / "pilot-icon.png", optimize=True)
square.save(
    root / "assets" / "myrchik.ico",
    format="ICO",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
