"""Streaming equivalent of the validated byte lexer, skipping ordinary spans in C.

Only bare NaN/Infinity/-Infinity are replaced with parser-view null. Quoted text,
escapes and all other bytes remain exact. Numeric-value readers remain separate.
"""
import collections
import re

SPECIAL = re.compile(rb'"|\\|NaN|-?Infinity')


def word_byte(value):
    return value == 45 or 65 <= value <= 90 or 97 <= value <= 122


class FastNormalizer:
    def __init__(self, raw, chunk_bytes=1024 * 1024):
        if chunk_bytes <= 0:
            raise ValueError("chunk_bytes must be positive")
        self.raw, self.chunk_bytes = raw, chunk_bytes
        self.pending = b""
        self.previous = b" "
        self.output = bytearray()
        self.in_string = False
        self.escaped = False
        self.eof = False
        self.c = collections.Counter()
        self.n = 0

    def process(self, final=False):
        data = self.previous + self.pending
        limit = len(data) if final else max(1, len(data) - 16)
        cursor = 1
        for match in SPECIAL.finditer(data, 1):
            start, end = match.span()
            if start >= limit:
                break
            if end > limit:
                limit = start
                break
            if self.in_string and self.escaped and start > cursor:
                self.escaped = False
            self.output.extend(data[cursor:start])
            token = match.group()
            if token == b'"':
                if self.in_string and self.escaped:
                    self.escaped = False
                else:
                    self.in_string = not self.in_string
                self.output.extend(token)
            elif token == b"\\":
                if self.in_string:
                    self.escaped = not self.escaped
                self.output.extend(token)
            elif not self.in_string and not word_byte(data[start - 1]) and (end == len(data) or not word_byte(data[end])):
                self.output.extend(b"null")
                self.c[token.decode("ascii")] += 1
            else:
                self.output.extend(token)
                if self.in_string:
                    self.escaped = False
            cursor = end
        if self.in_string and self.escaped and limit > cursor:
            self.escaped = False
        self.output.extend(data[cursor:limit])
        self.previous = data[limit - 1:limit]
        self.pending = data[limit:]

    def fill(self, count):
        while len(self.output) < count and not self.eof:
            chunk = self.raw.read(self.chunk_bytes)
            self.n += len(chunk)
            self.pending += chunk
            if not chunk:
                self.process(final=True)
                self.eof = True
            else:
                self.process()

    def read(self, count=-1):
        if count == 0:
            return b""
        if count < 0:
            while not self.eof:
                self.fill(len(self.output) + 1)
            count = len(self.output)
        else:
            self.fill(count)
        result = bytes(self.output[:count])
        del self.output[:count]
        return result
