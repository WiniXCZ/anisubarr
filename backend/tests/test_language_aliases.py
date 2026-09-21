"""
One language table, not three.

There used to be three, disagreeing: the folding table in utils knew eleven
languages but not Korean, the filter in subtitles.py went the other way and
knew nothing of Spanish, Italian, Portuguese or Romanian, and the line editor
knew three languages in total. A Spanish subtitle behaved differently
depending on which part of the code received it.
"""
from app.routers.subtitle_lines import _LANG_ALIASES as LINES_TABLE
from app.routers.subtitles import _LANG_ALIASES as FILTER_TABLE
from app.utils import (CS_LANGS, CS_NAMES, LANGUAGE_VARIANTS, _LANG_ALIASES,
                       variants_of)


def test_all_three_call_sites_share_one_table():
    assert FILTER_TABLE is LANGUAGE_VARIANTS
    assert LINES_TABLE is LANGUAGE_VARIANTS


def test_the_languages_that_were_missing_are_there():
    for code in ("es", "it", "pt", "ro", "ko"):
        assert code in LANGUAGE_VARIANTS, code


def test_folding_and_expanding_agree():
    """Every variant folds back onto the code it expands from — the two
    directions are derived from one mapping, so they cannot drift apart."""
    for code, variants in LANGUAGE_VARIANTS.items():
        for variant in variants:
            assert _LANG_ALIASES.get(variant, variant) == code, (variant, code)


def test_a_variant_belongs_to_exactly_one_language():
    seen: dict[str, str] = {}
    for code, variants in LANGUAGE_VARIANTS.items():
        for variant in variants:
            assert variant not in seen, (variant, code, seen.get(variant))
            seen[variant] = code


def test_czech_still_covers_what_sonarr_sends():
    """`cze` arrived 301 times in the live data."""
    assert CS_LANGS <= CS_NAMES
    assert {"cze", "ces", "cz", "czech"} <= CS_NAMES


def test_an_unknown_code_expands_to_itself():
    assert variants_of("xx") == {"xx"}
    assert variants_of("") == set()


def test_the_code_is_among_its_own_variants():
    for code, variants in LANGUAGE_VARIANTS.items():
        assert code in variants, code
