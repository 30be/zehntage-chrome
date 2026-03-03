"""Tests for the native messaging host."""
import json
import os
import struct
import subprocess
import sys
import tempfile
import unittest


HOST_SCRIPT = os.path.join(os.path.dirname(__file__), "zehntage_host.py")


def make_native_message(obj):
    """Encode a message in Chrome native messaging format."""
    encoded = json.dumps(obj).encode("utf-8")
    return struct.pack("=I", len(encoded)) + encoded


def parse_native_response(data):
    """Decode a native messaging response."""
    length = struct.unpack("=I", data[:4])[0]
    return json.loads(data[4 : 4 + length])


def run_host(msg, tsv_path):
    """Run the host script with a message, using a custom TSV path."""
    env = os.environ.copy()
    proc = subprocess.run(
        [sys.executable, "-c", f"""
import sys, os
sys.path.insert(0, os.path.dirname({HOST_SCRIPT!r}))
import zehntage_host
zehntage_host.TSV_PATH = {tsv_path!r}
zehntage_host.main()
"""],
        input=make_native_message(msg),
        capture_output=True,
        env=env,
    )
    if proc.returncode != 0 and proc.stderr:
        raise RuntimeError(proc.stderr.decode())
    return parse_native_response(proc.stdout)


class TestNativeHost(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.tsv_path = os.path.join(self.tmpdir, "zehntage_words.tsv")

    def tearDown(self):
        if os.path.exists(self.tsv_path):
            os.remove(self.tsv_path)
        os.rmdir(self.tmpdir)

    def test_read_empty(self):
        """Reading when no TSV exists returns empty dict."""
        resp = run_host({"action": "read"}, self.tsv_path)
        self.assertEqual(resp, {"words": {}})

    def test_write_then_read(self):
        """Writing a word then reading it back works."""
        entry = {
            "front": "Hund",
            "back": "dog",
            "notes": "Common word",
            "context": "Der Hund ist groß",
        }
        resp = run_host({"action": "write", "entry": entry}, self.tsv_path)
        self.assertEqual(resp, {"ok": True})

        resp = run_host({"action": "read"}, self.tsv_path)
        words = resp["words"]
        self.assertIn("hund", words)
        self.assertEqual(words["hund"]["back"], "dog")
        self.assertEqual(words["hund"]["notes"], "Common word")
        self.assertEqual(words["hund"]["context"], "Der Hund ist groß")

    def test_write_multiple(self):
        """Writing multiple words preserves all entries."""
        for word, trans in [("katze", "cat"), ("hund", "dog"), ("vogel", "bird")]:
            run_host(
                {
                    "action": "write",
                    "entry": {
                        "front": word,
                        "back": trans,
                        "notes": "",
                        "context": "",
                    },
                },
                self.tsv_path,
            )

        resp = run_host({"action": "read"}, self.tsv_path)
        words = resp["words"]
        self.assertEqual(len(words), 3)
        self.assertEqual(words["katze"]["back"], "cat")
        self.assertEqual(words["hund"]["back"], "dog")
        self.assertEqual(words["vogel"]["back"], "bird")

    def test_write_overwrites_existing(self):
        """Writing the same word again updates it."""
        entry1 = {"front": "Hund", "back": "dog", "notes": "", "context": ""}
        entry2 = {
            "front": "hund",
            "back": "dog, hound",
            "notes": "Updated",
            "context": "new context",
        }
        run_host({"action": "write", "entry": entry1}, self.tsv_path)
        run_host({"action": "write", "entry": entry2}, self.tsv_path)

        resp = run_host({"action": "read"}, self.tsv_path)
        words = resp["words"]
        self.assertEqual(len(words), 1)
        self.assertEqual(words["hund"]["back"], "dog, hound")
        self.assertEqual(words["hund"]["notes"], "Updated")

    def test_case_insensitive_keys(self):
        """Word keys are stored lowercase."""
        entry = {"front": "SCHMETTERLING", "back": "butterfly", "notes": "", "context": ""}
        run_host({"action": "write", "entry": entry}, self.tsv_path)

        resp = run_host({"action": "read"}, self.tsv_path)
        self.assertIn("schmetterling", resp["words"])
        self.assertNotIn("SCHMETTERLING", resp["words"])

    def test_tsv_format(self):
        """TSV file has correct header and pipe-delimited format."""
        entry = {"front": "wort", "back": "word", "notes": "from Old High German", "context": "Das Wort"}
        run_host({"action": "write", "entry": entry}, self.tsv_path)

        with open(self.tsv_path) as f:
            lines = f.readlines()
        self.assertEqual(lines[0].strip(), "front|back|notes|context")
        self.assertEqual(lines[1].strip(), "wort|word|from Old High German|Das Wort")

    def test_newlines_in_context_replaced(self):
        """Newlines in context and notes are replaced with spaces."""
        entry = {
            "front": "test",
            "back": "test",
            "notes": "line1\nline2",
            "context": "before\nafter",
        }
        run_host({"action": "write", "entry": entry}, self.tsv_path)

        with open(self.tsv_path) as f:
            lines = f.readlines()
        self.assertNotIn("\n", lines[1].split("|")[2])
        # The context field is everything after the third pipe on the data line
        data_line = lines[1].strip()
        parts = data_line.split("|", 3)
        self.assertEqual(parts[2], "line1 line2")
        self.assertEqual(parts[3], "before after")

    def test_read_existing_tsv(self):
        """Can read a TSV file written by the nvim plugin."""
        with open(self.tsv_path, "w") as f:
            f.write("front|back|notes|context\n")
            f.write("angst|fear|Same word in English|Die <b>Angst</b> war groß\n")

        resp = run_host({"action": "read"}, self.tsv_path)
        words = resp["words"]
        self.assertEqual(words["angst"]["back"], "fear")
        self.assertEqual(words["angst"]["notes"], "Same word in English")

    def test_unknown_action(self):
        """Unknown action returns error."""
        resp = run_host({"action": "bogus"}, self.tsv_path)
        self.assertIn("error", resp)


if __name__ == "__main__":
    unittest.main()
