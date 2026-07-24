"""Put redteam/ on sys.path so the adapter module imports cleanly in tests.

The adapters ship as flat files dropped into the platform runtime, not a
package, so tests import them by bare name.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
