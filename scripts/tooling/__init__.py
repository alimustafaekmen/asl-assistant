"""Environment diagnosis and setup policy for the repository's own commands.

These modules hold logic the Makefile used to embed as Python source strings.
Moving it here makes it importable, so the states it distinguishes can be
tested directly rather than by searching the Makefile for a line of code.
"""
