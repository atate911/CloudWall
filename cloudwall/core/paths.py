"""Where CloudWall's own files are, wherever its modules sit in the package: the bundled tables
(data/), the page (web/) and the example config. One home for these, so a module can move
between layers without its files going missing."""
from pathlib import Path

PACKAGE = Path(__file__).resolve().parent.parent      # (this file is in core/)
DATA = PACKAGE / "data"            # reference tables: airports, airlines, types, runways, ...
WEB = PACKAGE / "web"              # the page: everything in it is served as it is
EXAMPLE = PACKAGE / "config.example.toml"
