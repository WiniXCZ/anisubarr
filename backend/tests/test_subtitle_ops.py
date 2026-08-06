"""
The editing operations, judged by what they do to a broken subtitle.

Each test is a fault you actually hit in a hand-downloaded file: a rip timed for
a 25 fps broadcast, two lines on screen at once, a caption that flashes for a
third of a second, a translator's note left in the middle of the dialogue.
"""
import os
import tempfile

_tmpdir = tempfile.mkdtemp(prefix="anisubarr-ops-test-")
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_tmpdir}/test.db")
os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production")

import pytest  # noqa: E402

from app.services import subtitle_ops as ops  # noqa: E402


def cue(start, end, text="ahoj"):
    return {"start": start, "end": end, "text": text}


def times(lines):
    return [(round(c["start"], 3), round(c["end"], 3)) for c in lines]


# ── analysis ─────────────────────────────────────────────────────────────────

def test_a_clean_file_reports_nothing():
    clean = [cue(0, 2, "první řádek"), cue(3, 5, "druhý řádek")]
    assert ops.analyze(clean)["summary"] == {}


def test_a_caption_nobody_can_read_in_time_is_flagged():
    fast = cue(0, 1, "Tohle je opravdu dlouhá věta, kterou nikdo za jednu vteřinu nepřečte.")
    assert "fast" in ops.analyze([fast])["summary"]


def test_markup_does_not_count_towards_reading_speed():
    """<i> is not on screen, so it must not push a fine cue over the limit."""
    plain = cue(0, 2, "krátký text")
    tagged = cue(0, 2, "<i>krátký text</i>")
    assert ops.cps(tagged) == ops.cps(plain)


def test_two_cues_on_screen_at_once_are_flagged():
    assert ops.analyze([cue(0, 5), cue(3, 7)])["summary"]["overlap"] == 1


def test_a_line_too_wide_for_the_screen_is_flagged():
    assert "wide" in ops.analyze([cue(0, 5, "x" * 60)])["summary"]


def test_a_cue_that_ends_before_it_starts_is_flagged():
    summary = ops.analyze([cue(10, 4)])["summary"]
    assert summary["negative"] == 1
    # A duration of -6 s must not be reported as a reading-speed problem too.
    assert "fast" not in summary


def test_the_report_says_which_line_to_look_at():
    issues = ops.analyze([cue(0, 2, "dobrý"), cue(3, 3.1, "spěch")])["issues"]
    assert "0" not in issues and "short" in issues["1"]


# ── fixes ────────────────────────────────────────────────────────────────────

def test_overlapping_cues_stop_overlapping():
    fixed = ops.fix([cue(0, 5), cue(3, 7)], ["overlap"])
    assert fixed["lines"][0]["end"] < fixed["lines"][1]["start"]
    assert fixed["report"] == {"overlap": 1}


def test_a_fix_leaves_a_gap_rather_than_touching_exactly():
    """Back to back to the millisecond makes players flash both lines."""
    fixed = ops.fix([cue(0, 5), cue(3, 7)], ["overlap"])["lines"]
    assert fixed[1]["start"] - fixed[0]["end"] >= 0.04


def test_an_empty_cue_is_dropped():
    fixed = ops.fix([cue(0, 2, "text"), cue(3, 4, "   "), cue(5, 6, "<i></i>")], ["empty"])
    assert len(fixed["lines"]) == 1
    assert fixed["report"]["empty"] == 2


def test_a_flash_frame_gets_a_readable_duration():
    fixed = ops.fix([cue(10, 10.2, "text")], ["min_duration"])["lines"]
    assert fixed[0]["end"] - fixed[0]["start"] == pytest.approx(ops.MIN_DURATION)


def test_lengthening_a_cue_never_creates_an_overlap():
    """Fixing one rule must not hand the next rule a new problem."""
    fixed = ops.fix([cue(10, 10.2, "a"), cue(10.5, 12, "b")], ["min_duration"])["lines"]
    assert fixed[0]["end"] < fixed[1]["start"]


def test_a_caption_left_on_screen_forever_is_capped():
    fixed = ops.fix([cue(0, 30, "text")], ["max_duration"])["lines"]
    assert fixed[0]["end"] == ops.MAX_DURATION


def test_a_repeated_line_becomes_one_cue():
    same = [cue(0, 2, "Pokračování"), cue(2.1, 4, "Pokračování")]
    fixed = ops.fix(same, ["duplicates"])
    assert times(fixed["lines"]) == [(0, 4)]


def test_the_same_words_later_in_the_episode_are_left_alone():
    """"Ano" said twice is two lines, not a duplicate."""
    apart = [cue(0, 2, "Ano"), cue(300, 302, "Ano")]
    assert len(ops.fix(apart, ["duplicates"])["lines"]) == 2


def test_stripping_styling_is_something_you_have_to_ask_for():
    styled = [cue(0, 2, "<i>kurzíva</i>")]
    assert ops.fix(styled, ["spaces"])["lines"][0]["text"] == "<i>kurzíva</i>"
    assert ops.fix(styled, ["tags"])["lines"][0]["text"] == "kurzíva"


def test_asking_for_the_usual_repairs_keeps_the_styling():
    """"Fix errors" with nothing ticked must not be the destructive one."""
    styled = [cue(0, 2, "<i>kurzíva</i>")]
    assert ops.fix(styled)["lines"][0]["text"] == "<i>kurzíva</i>"
    assert "tags" not in ops.SAFE_RULES


def test_fixing_twice_leaves_nothing_to_warn_about():
    """A warning the fix button can't clear sends people looking for a bug.
    A cue hemmed in by its neighbour is lengthened as far as it fits, and the
    report has to accept that instead of asking for the impossible."""
    cramped = [cue(7.0, 7.2, "bliknutí"), cue(8.0, 12.0, "další")]

    fixed = ops.fix(cramped, ["min_duration", "overlap"])["lines"]
    assert fixed[0]["end"] < cramped[1]["start"]          # no new overlap
    assert "short" not in ops.analyze(fixed)["summary"]   # and no leftover warning


def test_a_genuinely_cramped_cue_is_still_reported():
    """The tolerance is one frame, not a licence to ignore a flash frame."""
    no_room = [cue(7.0, 7.2, "bliknutí"), cue(7.3, 12.0, "další")]
    fixed = ops.fix(no_room, ["min_duration", "overlap"])["lines"]
    assert "short" in ops.analyze(fixed)["summary"]


def test_the_report_only_names_rules_that_changed_something():
    fixed = ops.fix([cue(0, 2, "v pořádku")], ["empty", "overlap", "spaces"])
    assert fixed["report"] == {}


def test_cues_out_of_order_are_sorted():
    fixed = ops.fix([cue(10, 12, "b"), cue(1, 2, "a")], ["order"])["lines"]
    assert [c["text"] for c in fixed] == ["a", "b"]
    assert [c["id"] for c in fixed] == [1, 2]


def test_untidy_spacing_is_cleaned_up():
    messy = [cue(0, 2, "  slovo    a  další ,  konec  ")]
    assert ops.fix(messy, ["spaces"])["lines"][0]["text"] == "slovo a další, konec"


def test_an_unknown_rule_is_ignored_rather_than_crashing():
    assert ops.fix([cue(0, 2)], ["neexistuje"])["report"] == {}


# ── timing ───────────────────────────────────────────────────────────────────

def test_shifting_moves_every_cue():
    assert times(ops.shift([cue(1, 2), cue(5, 6)], 1.5)) == [(2.5, 3.5), (6.5, 7.5)]


def test_shifting_the_tail_leaves_the_start_alone():
    """The half of the episode that was in sync must stay in sync."""
    moved = ops.shift([cue(1, 2), cue(5, 6), cue(9, 10)], 2, from_index=1)
    assert times(moved) == [(1, 2), (7, 8), (11, 12)]


def test_a_shift_never_pushes_a_cue_before_zero():
    assert times(ops.shift([cue(1, 2)], -10)) == [(0, 0)]


def test_stretching_grows_with_the_timestamp():
    """The 25 → 23.976 fps case: a fixed offset cannot fix it, a factor can."""
    stretched = ops.scale([cue(0, 1), cue(600, 601)], 25 / 23.976)
    assert stretched[0]["start"] == 0
    assert stretched[1]["start"] == pytest.approx(625.626, abs=0.01)


def test_a_zero_or_negative_factor_is_refused():
    with pytest.raises(ValueError):
        ops.scale([cue(0, 1)], 0)


def test_two_known_points_line_the_file_up():
    """Someone times the first line and one near the end; that is enough."""
    lines = [cue(10, 12), cue(600, 602), cue(1200, 1202)]
    synced = ops.sync_two_points(lines, (10, 12), (1200, 1205))

    assert synced[0]["start"] == pytest.approx(12)
    assert synced[2]["start"] == pytest.approx(1205)
    # And the cue between them lands where the same correction puts it.
    assert synced[1]["start"] == pytest.approx(603.487, abs=0.01)


def test_two_points_on_the_same_cue_are_refused():
    with pytest.raises(ValueError):
        ops.sync_two_points([cue(0, 1)], (10, 12), (10, 900))


def test_points_given_backwards_are_refused():
    with pytest.raises(ValueError):
        ops.sync_two_points([cue(0, 1)], (10, 900), (1200, 12))


# ── text ─────────────────────────────────────────────────────────────────────

def test_replace_counts_every_hit_and_every_cue():
    lines = [cue(0, 2, "Frieren a Frieren"), cue(3, 4, "Fern"), cue(5, 6, "Frieren")]
    out = ops.replace(lines, "Frieren", "Frýren")

    assert (out["count"], out["cues"]) == (3, 2)
    assert out["lines"][0]["text"] == "Frýren a Frýren"


def test_replace_is_literal_unless_asked_otherwise():
    """A search for "a.b" must not match "axb"."""
    assert ops.replace([cue(0, 2, "axb")], "a.b", "-")["count"] == 0
    assert ops.replace([cue(0, 2, "axb")], "a.b", "-", regex=True)["count"] == 1


def test_replace_can_ignore_case():
    assert ops.replace([cue(0, 2, "FRIEREN")], "frieren", "x",
                       case_sensitive=False)["count"] == 1


def test_a_broken_regex_is_the_users_mistake_not_a_crash():
    with pytest.raises(ValueError):
        ops.replace([cue(0, 2)], "(unclosed", "x", regex=True)


def test_replacing_nothing_changes_nothing():
    assert ops.replace([cue(0, 2, "text")], "", "x")["count"] == 0


# ── cue list ─────────────────────────────────────────────────────────────────

def test_splitting_divides_the_time_and_the_two_lines():
    lines = ops.split_cue([cue(0, 4, "Kdo je tam?\nJá.")], 0)
    assert times(lines) == [(0, 2), (2, 4)]
    assert [c["text"] for c in lines] == ["Kdo je tam?", "Já."]


def test_splitting_at_the_playhead_uses_that_time():
    lines = ops.split_cue([cue(0, 4, "text")], 0, at=1.0)
    assert times(lines) == [(0, 1), (1, 4)]


def test_splitting_outside_the_cue_is_refused():
    with pytest.raises(ValueError):
        ops.split_cue([cue(0, 4, "text")], 0, at=9.0)


def test_merging_joins_the_text_and_spans_both():
    lines = ops.merge_cues([cue(0, 2, "Ta věta"), cue(2.5, 5, "pokračuje.")], [0, 1])
    assert times(lines) == [(0, 5)]
    assert lines[0]["text"] == "Ta věta\npokračuje."


def test_only_neighbours_can_be_merged():
    """Merging cue 1 and cue 9 would silently swallow everything between."""
    lines = [cue(0, 1, "a"), cue(2, 3, "b"), cue(4, 5, "c")]
    with pytest.raises(ValueError):
        ops.merge_cues(lines, [0, 2])


def test_inserting_puts_the_cue_in_the_right_place():
    lines = ops.insert_cue([cue(0, 2, "a"), cue(10, 12, "c")], 5, 6, "b")
    assert [c["text"] for c in lines] == ["a", "b", "c"]
    assert [c["id"] for c in lines] == [1, 2, 3]


def test_an_inserted_cue_must_have_a_length():
    with pytest.raises(ValueError):
        ops.insert_cue([cue(0, 2)], 5, 5)


def test_deleting_renumbers_what_is_left():
    lines = ops.delete_cues([cue(0, 1, "a"), cue(2, 3, "b"), cue(4, 5, "c")], [1])
    assert [c["text"] for c in lines] == ["a", "c"]
    assert [c["id"] for c in lines] == [1, 2]


# ── the input is never mutated ───────────────────────────────────────────────

@pytest.mark.parametrize("run", [
    lambda lines: ops.fix(lines, ["overlap", "min_duration"]),
    lambda lines: ops.shift(lines, 5),
    lambda lines: ops.scale(lines, 1.2),
    lambda lines: ops.replace(lines, "ahoj", "nazdar"),
    lambda lines: ops.delete_cues(lines, [0]),
])
def test_the_original_cues_survive_untouched(run):
    """Undo in the editor rewinds to the list it kept — an operation that edited
    that list in place would make the history a copy of the present."""
    original = [cue(0, 5, "ahoj"), cue(3, 7, "ahoj")]
    before = [dict(c) for c in original]

    run(original)
    assert original == before
