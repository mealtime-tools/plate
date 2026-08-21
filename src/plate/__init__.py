"""Where the viewer's files are, and nothing else.

Plate is a static page: it decodes a recipe out of a URL fragment and renders
it, with no network access of any kind. Two things consume the same bytes —
GitHub Pages serves them from the repository root, and a Python caller serving
them locally finds them through `assets_dir`.

The dependency runs one way. Plate knows nothing about the `recipes` package;
`recipes` depends on plate. If something here starts needing to import recipes,
the split is wrong — say so rather than working around it.
"""

from importlib import resources
from pathlib import Path

ASSETS = (
    "index.html",
    "style.css",
    "app.mjs",
    "api.mjs",
    "recipe.mjs",
    "qr.mjs",
    "yaml.mjs",
)

FRAGMENT_KEY = "r"
"""The fragment parameter carrying a recipe. Kept here because the page reads
it and a link builder writes it, and the two must not drift."""


def assets_dir() -> Path:
    """The directory holding the page, in a wheel or a source checkout.

    A wheel has them under `plate/assets`; a checkout has them at the
    repository root, where Pages serves them. Both are real locations, so both
    are looked for rather than one being assumed.
    """
    packaged = Path(str(resources.files("plate") / "assets"))
    if (packaged / "index.html").is_file():
        return packaged

    checkout = Path(__file__).resolve().parents[2]
    if (checkout / "index.html").is_file():
        return checkout

    raise RuntimeError(f"plate assets not found at {packaged} or {checkout}")


def contract_fixture() -> Path:
    """One exported document, as the page emits it today.

    Published so a consumer can assert compatibility against real bytes rather
    than a description of them. Plate's own suite regenerates and pins it, so
    changing the emitter without refreshing this file fails there first.
    """
    packaged = Path(
        str(resources.files("plate") / "fixtures" / "exported-example.yaml")
    )
    if packaged.is_file():
        return packaged

    checkout = (
        Path(__file__).resolve().parents[2]
        / "fixtures"
        / "exported-example.yaml"
    )
    if checkout.is_file():
        return checkout

    raise RuntimeError(
        f"plate contract fixture not found at {packaged} or {checkout}"
    )


def asset_paths() -> dict[str, Path]:
    """Every file the page needs, by the name it is requested under."""
    directory = assets_dir()
    return {name: directory / name for name in ASSETS}
