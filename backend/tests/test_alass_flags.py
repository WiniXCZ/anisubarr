"""
The alass settings that steered nothing.

alass ran as `alass <reference> <subtitle> <output>` — no options at all —
while four settings in the UI claimed to tune it. Checked against
`alass --help` of the version in the image (alass-cli 2.0.0), only one of the
four named a switch that exists.
"""
import os
import tempfile
from unittest.mock import patch

_tmpdir = tempfile.mkdtemp(prefix="anisubarr-alass-test-")
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_tmpdir}/test.db")
os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production")

import pytest  # noqa: E402

from app.routers import subtitle_sync  # noqa: E402


@pytest.fixture
def settings():
    """Stand in for the settings table."""
    values: dict[str, str] = {}
    with patch("app.utils.settings_helper.read_setting",
               lambda key, db=None, default=None: values.get(key, "")):
        yield values


def test_no_settings_means_no_flags(settings):
    assert subtitle_sync._alass_flags() == []


def test_skipping_the_framerate_fix_maps_to_a_real_switch(settings):
    settings["alass_no_fix_framerate"] = "true"
    assert subtitle_sync._alass_flags() == ["--disable-fps-guessing"]


def test_no_split_is_passed_through(settings):
    settings["alass_no_split"] = "true"
    assert "--no-split" in subtitle_sync._alass_flags()


def test_the_split_penalty_carries_its_value(settings):
    settings["alass_split_penalty"] = "12"
    assert subtitle_sync._alass_flags() == ["--split-penalty", "12"]


def test_speed_optimization_carries_its_value(settings):
    settings["alass_speed_optimization"] = "3"
    assert subtitle_sync._alass_flags() == ["--speed-optimization", "3"]


def test_zero_means_let_alass_decide(settings):
    """The UI writes 0 for "unset"; passing --speed-optimization 0 would be a
    different instruction than not passing it."""
    settings["alass_speed_optimization"] = "0"
    settings["alass_split_penalty"] = "0"
    assert subtitle_sync._alass_flags() == []


def test_a_value_that_is_not_a_number_is_ignored_not_passed_on(settings):
    """A bad setting must not turn into a command line alass rejects — that
    would fail every sync instead of just that one option."""
    settings["alass_split_penalty"] = "hodně"
    assert subtitle_sync._alass_flags() == []


def test_the_retired_settings_are_not_resurrected(settings):
    """Neither names a switch alass has; passing one fails the whole run."""
    settings["alass_golden_section_search"] = "true"
    settings["alass_max_offset_seconds"] = "60"
    settings["alass_use_audio_reference"] = "true"
    assert subtitle_sync._alass_flags() == []


def test_the_flags_go_before_the_positional_arguments(settings):
    """alass takes [OPTIONS] <reference> <incorrect> <output>."""
    settings["alass_no_fix_framerate"] = "true"
    command = ["alass", *subtitle_sync._alass_flags(), "ref", "sub", "out"]
    assert command.index("--disable-fps-guessing") < command.index("ref")
