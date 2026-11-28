"""Where CloudWall's bundled files are; modules take paths from here, not from __file__."""
from pathlib import Path

PACKAGE = Path(__file__).resolve().parent.parent      # this file is in core/
DATA = PACKAGE / "data"            # reference tables
WEB = PACKAGE / "web"              # everything in it is served as it is
