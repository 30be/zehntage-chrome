#!/usr/bin/env python3
"""Native messaging host for ZehnTage Chrome extension.
Reads/writes ~/.local/share/nvim/zehntage_words.tsv
"""
import json
import os
import struct
import sys

TSV_PATH = os.path.expanduser("~/.local/share/nvim/zehntage_words.tsv")


def read_message():
    raw_length = sys.stdin.buffer.read(4)
    if not raw_length or len(raw_length) < 4:
        sys.exit(0)
    length = struct.unpack("=I", raw_length)[0]
    msg = sys.stdin.buffer.read(length).decode("utf-8")
    return json.loads(msg)


def send_message(obj):
    encoded = json.dumps(obj).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("=I", len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def read_words():
    words = {}
    if not os.path.exists(TSV_PATH):
        return words
    with open(TSV_PATH, "r") as f:
        first = True
        for line in f:
            if first:
                first = False
                continue
            line = line.rstrip("\n")
            parts = line.split("|", 3)
            if len(parts) >= 4:
                words[parts[0].lower()] = {
                    "back": parts[1],
                    "notes": parts[2],
                    "context": parts[3],
                }
    return words


def write_word(entry):
    words = read_words()
    key = entry["front"].lower()
    words[key] = {
        "back": entry["back"],
        "notes": entry.get("notes", ""),
        "context": entry.get("context", ""),
    }
    os.makedirs(os.path.dirname(TSV_PATH), exist_ok=True)
    with open(TSV_PATH, "w") as f:
        f.write("front|back|notes|context\n")
        for front, data in words.items():
            ctx = data["context"].replace("\n", " ")
            notes = data["notes"].replace("\n", " ")
            f.write(f"{front}|{data['back']}|{notes}|{ctx}\n")


def main():
    msg = read_message()
    if msg["action"] == "read":
        send_message({"words": read_words()})
    elif msg["action"] == "write":
        write_word(msg["entry"])
        send_message({"ok": True})
    else:
        send_message({"error": f"Unknown action: {msg['action']}"})


if __name__ == "__main__":
    main()
