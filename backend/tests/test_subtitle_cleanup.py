"""
The post-processing switches that did nothing.

Eight of them sat in the settings whitelist with no code reading any: the user
turned them on and the file was written exactly as it came off the provider.
"""
from app.services.subtitle_cleanup import STEPS, clean, decode

_ALL_OFF = {step: False for step in STEPS}
_SRT = ("1\n00:00:01,000 --> 00:00:03,000\n"
        "<i>Ahoj,</i> světe…\n\n")


def _on(*steps):
    return {**_ALL_OFF, **{s: True for s in steps}}


def test_nothing_enabled_returns_the_exact_bytes():
    """A file nobody asked to change must arrive byte for byte — re-encoding
    it 'helpfully' is how a working subtitle turns into a broken one."""
    raw = _SRT.encode("cp1250")
    assert clean(raw, "srt", _ALL_OFF) is raw


def test_html_tags_go():
    out = clean(_SRT.encode("utf-8"), "srt", _on("remove_tags")).decode()
    assert "<i>" not in out and "Ahoj, světe" in out


def test_ass_override_blocks_survive_tag_removal():
    """{\\an8} is not decoration, it is where the sign sits on the picture.
    Stripping it turns a typeset release into captions in the middle."""
    ass = "Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,{\\an8}Nápis\n"
    out = clean(ass.encode("utf-8"), "ass", _on("remove_tags")).decode()
    assert "{\\an8}" in out


def test_a_leftover_brace_block_in_an_srt_does_go():
    srt = "1\n00:00:01,000 --> 00:00:03,000\n{\\an8}Ahoj\n"
    out = clean(srt.encode("utf-8"), "srt", _on("remove_tags")).decode()
    assert "{\\an8}" not in out and "Ahoj" in out


def test_emoji_and_music_notes_go():
    line = "♪ Ahoj 🎵🔥 ♪\n"
    out = clean(line.encode("utf-8"), "srt", _on("remove_emoji")).decode()
    assert "♪" not in out and "🎵" not in out and "Ahoj" in out


def test_ocr_fixes_straighten_quotes_and_dashes():
    line = "„Ahoj“ – řekl…\n"
    out = clean(line.encode("utf-8"), "srt", _on("ocr_fixes")).decode()
    assert out.startswith('"Ahoj"') and "..." in out and "–" not in out


def test_common_fixes_drop_trailing_space_and_extra_blank_lines():
    messy = "1\n00:00:01,000 --> 00:00:03,000\nAhoj   světe   \n\n\n\n2\n"
    out = clean(messy.encode("utf-8"), "srt", _on("common_fixes")).decode()
    assert "Ahoj světe\n" in out
    assert "\n\n\n" not in out


def test_a_windows_encoded_file_comes_back_as_utf8():
    raw = "Příliš žluťoučký kůň\n".encode("cp1250")
    out = clean(raw, "srt", _on("encode_utf8"))
    assert out.decode("utf-8") == "Příliš žluťoučký kůň\n"


def test_undecodable_bytes_are_written_as_they_arrived():
    """Losing a subtitle to a cleanup step is far worse than a stray <i>."""
    raw = b"\xff\xfe\x00\x00 rozbite"
    assert clean(raw, "srt", _on("remove_tags", "common_fixes")) is not None


def test_decode_tries_the_encodings_czech_subtitles_arrive_in():
    assert decode("žluť".encode("cp1250")) == "žluť"
    assert decode("žluť".encode("utf-8")) == "žluť"
