"""CloudWall's layers, held to: each module imports only from its own layer and those below it,
and the three middle layers (what is sensed, what is gathered, what is remembered) don't import
each other. ROADMAP.md sets out why; a module in a layer's folder (cloudwall/core/geo.py) is in
that layer, and the few still at the top of the package are placed by FLAT below.

To add a module: put it in the folder of the layer it belongs to. If the test then fails, the module reaches upward: pass in what it needs instead (as the
tracker is given its store), or move the shared part down a layer."""
import ast
import unittest
from pathlib import Path

PACKAGE = Path(__file__).resolve().parent.parent / "cloudwall"

# lowest first; layers on the same rank may not import each other
RANK = {"core": 0, "reference": 1, "sense": 2, "gather": 2, "memory": 2, "picture": 3,
        "serve": 4, "operate": 4, "share": 4, "app": 5}

# modules outside a layer's folder: the package's own, and the radio until it is joined to the app
FLAT = {"__init__": "core", "__main__": "app", "radio": "picture"}


def module_name(path):
    """cloudwall/core/geo.py -> ("core", "geo"); cloudwall/geo.py -> ("geo",)."""
    parts = path.relative_to(PACKAGE).with_suffix("").parts
    return parts[:-1] if parts[-1] == "__init__" and len(parts) > 1 else parts


def layer_of(parts):
    if parts and parts[0] in RANK:
        return parts[0]
    return FLAT.get(parts[0]) if parts else None


def imports(path):
    """The modules of the package a file imports, as tuples of names (relative imports resolved)."""
    here = module_name(path)
    package = here if path.name == "__init__.py" else here[:-1]
    out = []
    for node in ast.walk(ast.parse(path.read_text())):
        if isinstance(node, ast.ImportFrom) and node.level:
            base = package[:len(package) - (node.level - 1)] if node.level > 1 else package
            if node.module:
                out.append(tuple(base) + tuple(node.module.split(".")))
            else:
                out += [tuple(base) + (a.name,) for a in node.names]
        elif isinstance(node, ast.ImportFrom) and (node.module or "").startswith("cloudwall"):
            out.append(tuple(node.module.split(".")[1:]))
        elif isinstance(node, ast.Import):
            out += [tuple(a.name.split(".")[1:]) for a in node.names if a.name.startswith("cloudwall.")]
    return out


def files():
    return [p for p in sorted(PACKAGE.rglob("*.py")) if "__pycache__" not in p.parts]


class LayersTest(unittest.TestCase):
    def test_every_module_has_a_layer(self):
        missing = [str(p.relative_to(PACKAGE)) for p in files() if layer_of(module_name(p)) is None]
        self.assertEqual(missing, [], "put these in a layer's folder")

    def test_imports_only_go_down(self):
        wrong = []
        for p in files():
            mine = layer_of(module_name(p))
            for dep in imports(p):
                theirs = layer_of(dep)
                if theirs is None or theirs == mine:
                    continue
                if RANK[theirs] >= RANK[mine]:
                    wrong.append(f"{p.relative_to(PACKAGE)} ({mine}) imports {'.'.join(dep)} ({theirs})")
        self.assertEqual(wrong, [], "a module may import only from its own layer and those below")


if __name__ == "__main__":
    unittest.main()
