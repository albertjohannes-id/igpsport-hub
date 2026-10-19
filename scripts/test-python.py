"""Run isolated Python tests with sibling backend modules on the import path."""
from pathlib import Path
import sys
import unittest
root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root / 'backend'))
suite = unittest.defaultTestLoader.discover(str(root / 'tests/python'))
result = unittest.TextTestRunner(verbosity=2).run(suite)
raise SystemExit(not result.wasSuccessful())
