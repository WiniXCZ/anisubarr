"""
Finding an anime on a site that has no search.

/search, /hledani and /anime?q= all answer 404 on kamui-subs.cz — every search
spent three requests learning that, then guessed one slug from the title. A
show filed under anything but its full name ("Frieren: Beyond Journey's End")
was therefore unreachable forever.
"""
from app.services.kamui import _slug_candidates, _slugify


def test_a_plain_title_is_its_own_slug():
    assert _slugify("Chainsaw Man") == "chainsaw-man"


def test_diacritics_and_odd_dashes_become_ascii():
    """An em dash or an accent went into the URL as-is and 404'd a page that
    may well exist under a clean slug."""
    assert _slugify("Re:Zero − Starting Life") == "re-zero-starting-life"
    assert _slugify("Kimi ni Todoke — From Me to You") == "kimi-ni-todoke-from-me-to-you"
    assert _slugify("Sakamoto Días") == "sakamoto-dias"


def test_an_apostrophe_closes_up_rather_than_splitting():
    """Sites file it as journeys-end, not journey-s-end."""
    assert _slugify("Journey's End") == "journeys-end"
    assert _slugify("Journey’s End") == "journeys-end"


def test_the_short_name_is_tried_too():
    candidates = _slug_candidates("Frieren: Beyond Journey's End")
    assert candidates[0] == "frieren-beyond-journeys-end"
    assert "frieren" in candidates


def test_release_noise_is_dropped_in_a_second_candidate():
    candidates = _slug_candidates("Kaguya-sama: Love is War (2019)")
    assert "kaguya-sama-love-is-war" in candidates


def test_a_season_suffix_gets_a_candidate_without_it():
    candidates = _slug_candidates("Mushoku Tensei: Jobless Reincarnation Season 2")
    assert "mushoku-tensei-jobless-reincarnation" in candidates


def test_the_list_stays_short():
    """Every candidate is a request to a site whose rate limits already cost
    an account once."""
    long_title = "A: B - C – D — E (2019) [BD] Season 3 Part 2"
    assert len(_slug_candidates(long_title)) <= 4


def test_tiny_fragments_are_not_worth_a_request():
    assert "re" not in _slug_candidates("Re:Zero − Starting Life in Another World")


def test_no_duplicates():
    candidates = _slug_candidates("Chainsaw Man")
    assert len(candidates) == len(set(candidates))


def test_a_title_that_slugifies_to_nothing_yields_nothing():
    assert _slug_candidates("!!!") == []
