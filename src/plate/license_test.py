from pathlib import Path

import tomllib


def test_project_has_declared_mit_license() -> None:
    root = Path(__file__).resolve().parents[2]
    metadata = tomllib.loads((root / "pyproject.toml").read_text())

    assert metadata["project"]["license"] == "MIT"
    assert (root / "LICENSE").read_text().startswith("MIT License\n")
