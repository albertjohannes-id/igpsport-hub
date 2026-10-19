"""Query OSV using only pinned package names/versions, never local app data."""
import json
from pathlib import Path
import sys
import requests

root = Path(__file__).resolve().parent.parent
packages = [line.split('==') for line in (root / 'requirements-trial.lock.txt').read_text().splitlines() if '==' in line]
try:
    response = requests.post('https://api.osv.dev/v1/querybatch', json={
        'queries': [{'package': {'ecosystem': 'PyPI', 'name': name}, 'version': version}
                    for name, version in packages]
    }, timeout=30)
    response.raise_for_status()
    results = response.json()['results']
    if len(results) != len(packages):
        raise ValueError('Incomplete advisory response')
    findings = [{'package': package[0], 'version': package[1],
                 'advisories': [v['id'] for v in result.get('vulns', [])]}
                for package, result in zip(packages, results) if result.get('vulns')]
    print(json.dumps({'packages_checked': len(packages), 'findings': findings}, indent=2))
    sys.exit(1 if findings else 0)
except (requests.RequestException, ValueError, KeyError):
    print('Advisory check unavailable or incomplete; no clean result can be claimed.')
    sys.exit(2)
