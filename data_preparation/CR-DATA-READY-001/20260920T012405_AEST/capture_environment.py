"""Record actual local preparation runtimes without altering any environment."""
import json
import subprocess
from datetime import datetime
from pathlib import Path

RUN = Path(__file__).resolve().parent
RUNTIMES = {
    "bundled_python": r"C:\Users\S.W\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe",
    "source_readonly_python": r"E:\desn 2000\data\battery_data_workspace_v0_3\.venv\Scripts\python.exe",
    "project_mat_decode_python": str(RUN / "datasets/.mcos_venv/Scripts/python.exe"),
    "project_rda_decode_python": str(RUN / "datasets/rda_supplement/.venv/Scripts/python.exe"),
}
PROBE = r'''
import importlib.metadata as md, json, platform, sys
names = ['numpy', 'scipy', 'pandas', 'h5py', 'ijson', 'openpyxl', 'xlrd',
         'mat-io', 'rdata', 'Pillow', 'pypdf', 'pdfplumber', 'PyMuPDF', 'cryptography', 'lxml',
         'xarray', 'python-dateutil', 'tzdata', 'packaging', 'six']
packages = {}
for name in names:
    try:
        dist = md.distribution(name)
        packages[name] = {'version': dist.version,
                          'license_expression': dist.metadata.get('License-Expression'),
                          'license': dist.metadata.get('License')}
    except md.PackageNotFoundError:
        packages[name] = None
print(json.dumps({'executable': sys.executable, 'python': platform.python_version(),
                  'platform': platform.platform(), 'packages': packages}))
'''


def main():
    environments = {}
    for name, executable in RUNTIMES.items():
        result = subprocess.run([executable, '-B', '-c', PROBE],
                                capture_output=True, text=True, encoding='utf-8', check=True)
        environments[name] = json.loads(result.stdout)
    manifest = {
        'recorded_at': datetime.now().astimezone().isoformat(),
        'status': 'OBSERVED_LOCAL_PREPARATION_ENVIRONMENTS',
        'environments': environments,
        'scope': 'Relevant installed parsing libraries; not a production dependency lock or server compatibility result.',
        'source_workspace_environment': 'POLICY_READ_ONLY; RDA worker installation violation and correction disclosed in datasets/rda_supplement/SOURCE_ENVIRONMENT_CORRECTION.json. This recorder is read-only.',
        'pre_incident_observations': 'PREPARATION_ENVIRONMENT.before_rda_incident.json; only explicitly observed packages form the comparison baseline, not a full environment snapshot.',
        'new_install_provenance': 'datasets/DEPENDENCY_PROVENANCE.json',
        'network_model_server_execution': False,
    }
    (RUN / 'PREPARATION_ENVIRONMENT.json').write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({name: row['python'] for name, row in environments.items()}))


if __name__ == '__main__':
    main()
