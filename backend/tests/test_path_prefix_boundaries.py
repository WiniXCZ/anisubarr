"""
A path mapping matches whole folders, not leading characters.

``startswith`` made the rule ``/data`` claim ``/database/dump.mkv`` and rewrite
it to ``/mediabase/dump.mkv`` — a path that exists nowhere. The symptom showed
up much later as "the folder is missing", with nothing pointing back at the
mapping that had mangled it. Sonarr roots like ``/data-4k`` and ``/data_old``
sit right next to ``/data``, so this is not hypothetical.
"""
import json
import os
import tempfile
from unittest.mock import patch

_tmpdir = tempfile.mkdtemp(prefix="anisubarr-prefix-test-")
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_tmpdir}/test.db")
os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production")

import pytest  # noqa: E402

from app.services import path_resolver  # noqa: E402


def _with(rules=(), **extra):
    values = {"path_mappings": json.dumps(list(rules)), **extra}
    return patch.object(path_resolver, "_cfg_value",
                        lambda key, default="": values.get(key, ""))


RULE = [{"from": "/data", "to": "/media"}]


def test_a_path_under_the_prefix_is_mapped():
    with _with(RULE):
        assert path_resolver.resolve("/data/media/anime/x.mkv") == "/media/media/anime/x.mkv"


@pytest.mark.parametrize("path", [
    "/database/dump.mkv",
    "/data-4k/anime/x.mkv",
    "/data_old/anime/x.mkv",
    "/datafile.mkv",
])
def test_a_sibling_folder_that_merely_starts_the_same_is_left_alone(path):
    with _with(RULE):
        assert path_resolver.resolve(path) == path


def test_the_prefix_on_its_own_maps_to_the_root():
    with _with(RULE):
        assert path_resolver.resolve("/data") == "/media"


def test_the_legacy_single_pair_respects_the_boundary_too():
    """The old settings path does its own stripping — it needed the same fix."""
    with _with([], path_sonarr_prefix="/data", path_local_prefix="/media"):
        assert path_resolver.resolve("/data/anime/x.mkv") == "/media/anime/x.mkv"
        assert path_resolver.resolve("/database/dump.mkv") == "/database/dump.mkv"


def test_a_trailing_slash_in_the_rule_changes_nothing():
    with _with([{"from": "/data/", "to": "/media/"}]):
        assert path_resolver.resolve("/data/anime/x.mkv") == "/media/anime/x.mkv"
        assert path_resolver.resolve("/database/x.mkv") == "/database/x.mkv"
